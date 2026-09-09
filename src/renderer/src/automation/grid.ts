import type { Block, Facing } from "@renderer/grid/face";
import { gridRegistry, type LiveGrid } from "@renderer/grid/grid-registry";

/**
 * Where things on the canvas are, in window pixels.
 *
 * The canvas has no DOM: a module, a socket or a knob is a shape Pixi drew, and the only way to point
 * a real mouse at one was to redo the layout arithmetic by hand and hope the viewport had not moved.
 * These answer in the coordinates `Input.dispatchMouseEvent` takes -- CSS pixels from the window's
 * top left -- by asking the renderer where it drew the thing and where the canvas sits on the page.
 *
 * Every function returns null rather than throwing when there is no canvas or no such thing, so a
 * script can ask and branch.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Point {
  x: number;
  y: number;
}

/** Everything the geometry needs, injectable so it can be tested with no Pixi at all. */
export interface GridSource {
  live(): LiveGrid | null;
}

const fromRegistry: GridSource = { live: () => gridRegistry.get() };

/** A patch-space point as a window point, given the canvas's place on the page. */
function toWindow(grid: LiveGrid, point: Point): Point {
  const box = grid.canvas.getBoundingClientRect();
  const screen = grid.renderer.viewport.toScreen(point);
  return { x: box.left + screen.x, y: box.top + screen.y };
}

/** A rectangle at a node's origin, scaled and placed on the page. */
function rectOf(
  grid: LiveGrid,
  origin: Point,
  box: { x: number; y: number; width: number; height: number },
): Rect {
  const zoom = grid.renderer.viewport.zoom;
  const topLeft = toWindow(grid, { x: origin.x + box.x, y: origin.y + box.y });
  return {
    x: topLeft.x,
    y: topLeft.y,
    width: box.width * zoom,
    height: box.height * zoom,
  };
}

/** One block of a face, as a script sees it: what it is, what it is for, and where. */
export interface FaceBlock {
  kind: Block["kind"];
  /** The face token: the port id, the param id, or `wave`. */
  name: string;
  rect: Rect;
  /** A jack's socket, or a knob's modulation socket; absent on a wave and an unmodulatable knob. */
  socket?: Point & { port: string; side: "input" | "output"; facing: Facing };
  /** A knob's centre. */
  centre?: Point;
}

export function createGridApi(source: GridSource = fromRegistry) {
  return {
    /** The canvas's box, or null when no grid is on screen. */
    canvas(): Rect | null {
      const grid = source.live();
      if (grid === null) return null;
      const box = grid.canvas.getBoundingClientRect();
      return { x: box.left, y: box.top, width: box.width, height: box.height };
    },

    /** The view's transform in patch space. */
    viewport(): { x: number; y: number; zoom: number } | null {
      const grid = source.live();
      if (grid === null) return null;
      const v = grid.renderer.viewport;
      return { x: v.x, y: v.y, zoom: v.zoom };
    },

    /**
     * A module's box on screen, and a point on its title bar: the place to press to select or drag
     * it without landing on a knob or a socket.
     */
    node(id: string): { rect: Rect; title: Point } | null {
      const grid = source.live();
      const node = grid?.renderer.allNodes().get(id);
      if (grid === null || grid === undefined || node === undefined)
        return null;
      const origin = { x: node.view.position.x, y: node.view.position.y };
      return {
        rect: rectOf(grid, origin, { x: 0, y: 0, ...node.face }),
        // The title bar is the first cell; its middle is clear of every control.
        title: toWindow(grid, {
          x: origin.x + node.face.width / 2,
          y: origin.y + 12,
        }),
      };
    },

    /** Every module drawn, with its box. */
    nodes(): { id: string; type: string; rect: Rect }[] {
      const grid = source.live();
      if (grid === null) return [];
      return [...grid.renderer.allNodes()].map(([id, node]) => ({
        id,
        type: node.descriptor.id,
        rect: rectOf(
          grid,
          { x: node.view.position.x, y: node.view.position.y },
          { x: 0, y: 0, ...node.face },
        ),
      }));
    },

    /**
     * A socket's centre. Inputs and outputs can share a name (`out` on both sides is unusual but
     * legal), so `side` picks; omitted, an output wins, then an input.
     */
    port(
      module: string,
      port: string,
      side?: "input" | "output",
    ): (Point & { side: "input" | "output"; facing: Facing }) | null {
      const grid = source.live();
      const node = grid?.renderer.allNodes().get(module);
      if (grid === null || grid === undefined || node === undefined)
        return null;
      const sides =
        side === undefined ? (["output", "input"] as const) : ([side] as const);
      for (const s of sides) {
        const found = node.face.sockets.find(
          (socket) => socket.port.id === port && socket.side === s,
        );
        if (found === undefined) continue;
        const at = toWindow(grid, {
          x: node.view.position.x + found.x,
          y: node.view.position.y + found.y,
        });
        return { ...at, side: s, facing: found.facing };
      }
      return null;
    },

    /** A knob's centre, for a parameter on the module's face. Null for one kept in the inspector. */
    knob(module: string, param: string): (Point & { radius: number }) | null {
      const grid = source.live();
      const node = grid?.renderer.allNodes().get(module);
      if (grid === null || grid === undefined || node === undefined)
        return null;
      const knob = node.face.knobs.find((k) => k.param.id === param);
      if (knob === undefined) return null;
      const at = toWindow(grid, {
        x: node.view.position.x + knob.centre.x,
        y: node.view.position.y + knob.centre.y,
      });
      return { ...at, radius: knob.radius * grid.renderer.viewport.zoom };
    },

    /**
     * Every block on a module's face, in reading order, with its box on screen: the whole of what
     * the module is made of, so a script can reach any of it by the name the engine gave it.
     */
    face(module: string): FaceBlock[] | null {
      const grid = source.live();
      const node = grid?.renderer.allNodes().get(module);
      if (grid === null || grid === undefined || node === undefined)
        return null;
      const origin = { x: node.view.position.x, y: node.view.position.y };
      return node.face.blocks.map((block): FaceBlock => {
        const out: FaceBlock = {
          kind: block.kind,
          name: block.name,
          rect: rectOf(grid, origin, block),
        };
        const socket = block.kind === "wave" ? null : block.socket;
        if (socket !== null)
          out.socket = {
            ...toWindow(grid, {
              x: origin.x + socket.x,
              y: origin.y + socket.y,
            }),
            port: socket.port.id,
            side: socket.side,
            facing: socket.facing,
          };
        if (block.kind === "knob")
          out.centre = toWindow(grid, {
            x: origin.x + block.centre.x,
            y: origin.y + block.centre.y,
          });
        return out;
      });
    },
  };
}

export type GridApi = ReturnType<typeof createGridApi>;

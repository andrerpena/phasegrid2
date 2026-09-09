import { gridRegistry, type LiveGrid } from "@renderer/grid/grid-registry";

/**
 * Where things on the canvas are, in window pixels.
 *
 * The canvas has no DOM: a module, a port or a knob is a shape Pixi drew, and the only way to point
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
      const zoom = grid.renderer.viewport.zoom;
      const topLeft = toWindow(grid, origin);
      return {
        rect: {
          x: topLeft.x,
          y: topLeft.y,
          width: node.layout.width * zoom,
          height: node.layout.height * zoom,
        },
        // The title bar is the first cell; its middle is clear of every control.
        title: toWindow(grid, {
          x: origin.x + node.layout.width / 2,
          y: origin.y + 12,
        }),
      };
    },

    /** Every module drawn, with its box. */
    nodes(): { id: string; type: string; rect: Rect }[] {
      const grid = source.live();
      if (grid === null) return [];
      return [...grid.renderer.allNodes()].map(([id, node]) => {
        const topLeft = toWindow(grid, {
          x: node.view.position.x,
          y: node.view.position.y,
        });
        const zoom = grid.renderer.viewport.zoom;
        return {
          id,
          type: node.descriptor.id,
          rect: {
            x: topLeft.x,
            y: topLeft.y,
            width: node.layout.width * zoom,
            height: node.layout.height * zoom,
          },
        };
      });
    },

    /**
     * A socket's centre. Inputs and outputs can share a name (`out` on both sides is unusual but
     * legal), so `side` picks; omitted, an output wins, then an input.
     */
    port(
      module: string,
      port: string,
      side?: "input" | "output",
    ): (Point & { side: "input" | "output"; edge: string }) | null {
      const grid = source.live();
      const node = grid?.renderer.allNodes().get(module);
      if (grid === null || grid === undefined || node === undefined)
        return null;
      const sides =
        side === undefined ? (["output", "input"] as const) : ([side] as const);
      for (const s of sides) {
        const list = s === "output" ? node.layout.outputs : node.layout.inputs;
        const found = list.find((p) => p.port.id === port);
        if (found === undefined) continue;
        const at = toWindow(grid, {
          x: node.view.position.x + found.x,
          y: node.view.position.y + found.y,
        });
        return { ...at, side: s, edge: found.edge };
      }
      return null;
    },

    /** A knob's centre, for a parameter on the module's face. Null for one kept in the inspector. */
    knob(module: string, param: string): (Point & { radius: number }) | null {
      const grid = source.live();
      const node = grid?.renderer.allNodes().get(module);
      if (grid === null || grid === undefined || node === undefined)
        return null;
      const control = node.layout.controls.find((c) => c.param.id === param);
      if (control === undefined) return null;
      const at = toWindow(grid, {
        x: node.view.position.x + control.x,
        y: node.view.position.y + control.y,
      });
      return { ...at, radius: control.radius * grid.renderer.viewport.zoom };
    },
  };
}

export type GridApi = ReturnType<typeof createGridApi>;

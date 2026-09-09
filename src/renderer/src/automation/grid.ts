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
  /**
   * The face token: the port id, the param id, the text property's id, `wave`, `scope`, `value`,
   * `meter`, `pianoRoll`, `piano`, or `title`.
   */
  name: string;
  rect: Rect;
  /** A jack's socket, or a knob's modulation socket; absent on the title, a wave and an unmodulatable knob. */
  socket?: Point & { port: string; side: "input" | "output"; facing: Facing };
  /** A knob's centre. */
  centre?: Point;
  /** Where modulation has a knob this frame, 0..1, or null with nothing in its socket. */
  live?: number | null;
  /**
   * What a scope last drew: the engine's count of the publish, how many frames, and the loudest
   * sample. Null until the engine has published one. The way a script sees a scope draw.
   */
  trace?: { index: string; frames: number; peak: number } | null;
  /**
   * What a readout last showed: the engine's count of the publish, and the value per channel. Null
   * until the engine has published one.
   */
  reading?: { index: string; channels: number[] } | null;
  /**
   * What a meter last showed: the engine's count of the publish, the held peak and RMS per channel,
   * and whether each has clipped. Null until the engine has published one.
   */
  /**
   * Which keys a keyboard lit last: the engine's count of the publish, and the MIDI numbers that
   * are down. Null until the engine has published one.
   */
  keys?: { index: string; held: number[] } | null;
  /** A keyboard's range as the document has it: the octave it starts on, and how many it shows. */
  range?: { low: number; octaves: number } | null;
  level?: {
    index: string;
    peak: number[];
    rms: number[];
    clipped: boolean[];
  } | null;
  /**
   * What a piano roll last drew: the engine's count of the publish, how many notes are in the
   * window, how many of them are sounding right now, and where the playhead is. Null until the
   * engine has published one. `sounding` is what a scenario watches move.
   */
  notes?: {
    index: string;
    count: number;
    sounding: number;
    phase: number;
  } | null;
  /** What a text property holds: the value from the document, or the module's default. */
  text?: string | null;
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
     * A module's box on screen, and a point on its title block: the place to press to select or drag
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
        // The title block's middle is clear of every control.
        title: toWindow(grid, {
          x: origin.x + node.face.title.x + node.face.title.width / 2,
          y: origin.y + node.face.title.y + node.face.title.height / 2,
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

    /**
     * A knob's centre, for a parameter on the module's face, and where modulation has it this
     * frame (0..1, or null with nothing in its socket): the one way a script can see a knob turn.
     * Null for a parameter kept in the inspector.
     */
    knob(
      module: string,
      param: string,
    ): (Point & { radius: number; live: number | null }) | null {
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
      return {
        ...at,
        radius: knob.radius * grid.renderer.viewport.zoom,
        live: node.liveOf(param),
      };
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
        const socket =
          block.kind === "jack" || block.kind === "knob" ? block.socket : null;
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
        if (block.kind === "knob") {
          out.centre = toWindow(grid, {
            x: origin.x + block.centre.x,
            y: origin.y + block.centre.y,
          });
          out.live = node.liveOf(block.name);
        }
        if (block.kind === "scope") out.trace = node.traceOf();
        if (block.kind === "value") out.reading = node.readingOf();
        if (block.kind === "meter") out.level = node.levelOf();
        if (block.kind === "pianoRoll") out.notes = node.notesOf();
        if (block.kind === "piano") {
          out.keys = node.keysOf();
          out.range = node.keyRangeOf();
        }
        if (block.kind === "text") out.text = node.textOf(block.name);
        return out;
      });
    },
  };
}

export type GridApi = ReturnType<typeof createGridApi>;

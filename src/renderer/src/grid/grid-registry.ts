import type { GridRenderer } from "./GridRenderer";

/**
 * The live grid, reachable from outside the canvas.
 *
 * The renderer is built inside a React effect and owned by nothing but that closure, which is right
 * for drawing and wrong for anything that has to ask it a question: the automation API needs to say
 * where a module, a port or a knob is on screen, and it cannot be handed a Pixi object through React.
 * Same arrangement as `viewport-store`: set when the canvas exists, null when it does not, read
 * inside the moment that needs it rather than held.
 */
export interface LiveGrid {
  renderer: GridRenderer;
  canvas: HTMLCanvasElement;
}

let live: LiveGrid | null = null;

export const gridRegistry = {
  set(grid: LiveGrid | null): void {
    live = grid;
  },
  get(): LiveGrid | null {
    return live;
  },
};

import type { ModuleDescriptor, ParamDesc } from "@shared/protocol/catalog";

/**
 * The grid's units and the arithmetic everything on it shares.
 *
 * What a node is made of and where each part sits is `face.ts`; this is the cell, the sizes a block
 * is measured in, snapping, and the small rectangle helpers the interaction needs. Pure, with no
 * graphics context, so a test can check it and so the renderer and the hit test cannot disagree.
 */

/**
 * The grid cell. Everything is measured in these.
 *
 * A module is a whole number of cells wide and tall and sits on cell boundaries, the way a rack unit
 * occupies whole units. That is not decoration: it is what makes a patch of thirty modules line up
 * instead of drifting into a collage, and it means two modules of the same size are the same size
 * rather than nearly.
 */
export const CELL = 24;

/** The title bar: one cell. */
export const HEADER_ROWS = 1;
export const HEADER_HEIGHT = HEADER_ROWS * CELL;

/** A socket's ring. */
export const PORT_RADIUS = 4;

/** The gutter a tile leaves around itself in its cells, so two neighbours show a seam between them. */
export const TILE_GUTTER = 1.5;
/** How far from a socket a click still counts, in patch units at 100% zoom. */
export const PORT_HIT_RADIUS = 9;

/** A knob with its label, as a composed face places one: two cells by two cells. */
export const KNOB_COLS = 2;
export const KNOB_ROWS = 2;
export const KNOB_CELL_WIDTH = KNOB_COLS * CELL;
export const KNOB_CELL_HEIGHT = KNOB_ROWS * CELL;
/** The knob in a two-by-two block, sized to sit inside its tile with its arc, its label and its socket; a larger block scales it up. */
export const KNOB_RADIUS = 9;
export const KNOB_HIT_RADIUS = KNOB_RADIUS + 4;

/** Narrowest a composed face gets: enough for a title and a port column either side. */
export const MIN_COLS = 3;

/**
 * How many controls a composed face shows.
 *
 * A wavetable oscillator has twenty-odd parameters and a face the size of a business card, so it can
 * only show a few. Which few the engine declares with the `primary` flag; this is the ceiling on how
 * many of them fit on a face the module did not lay out itself.
 */
export const MAX_FACE_CONTROLS = 4;

/**
 * The parameters a composed face puts on a node: the ones meant to be moved while it runs.
 *
 * Only for a module that declared no face of its own; a declared face names its knobs outright.
 */
export function faceParams(
  descriptor: ModuleDescriptor,
  max = MAX_FACE_CONTROLS,
): ParamDesc[] {
  const visible = descriptor.params.filter(
    (p) => !p.flags.hidden && !p.flags.enum,
  );
  const declared = visible.filter((p) => p.flags.primary);
  // The fallback is the guess this used to make for every module: better a plausible face than an
  // empty one. It is also why an oscillator used to wear its detune and distortion controls while its
  // level and tuning sat in the inspector, which is the whole reason the engine now says.
  const chosen =
    declared.length > 0 ? declared : visible.filter((p) => p.flags.modulatable);
  return chosen.slice(0, max);
}

export interface Point {
  x: number;
  y: number;
}

/** Snaps to the grid. A module always sits on cell boundaries, so this is how it is placed. */
export function snap(value: number, step: number = CELL): number {
  return step > 0 ? Math.round(value / step) * step : value;
}

/** Snaps a point to the cell grid. */
export function snapPoint(point: Point, step: number = CELL): Point {
  return { x: snap(point.x, step), y: snap(point.y, step) };
}

export function intersects(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

export function rectFromPoints(a: Point, b: Point) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/** Where a parameter's value sits between its ends, 0 to 1, for drawing an arc. */
export function paramFraction(param: ParamDesc, value: number): number {
  const span = param.max - param.min;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (value - param.min) / span));
}

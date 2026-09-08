import type {
  ModuleDescriptor,
  ParamDesc,
  PortDesc,
} from "@shared/protocol/catalog";

/**
 * Where everything on a node is, in patch coordinates.
 *
 * A node is not a title with a list of ports. It carries its performance controls on its face — knobs
 * with a value arc, a readout, a small display — the way a hardware module does, so a patch can be read
 * and played without opening anything. Ports run down the sides; controls sit between them.
 *
 * Pure geometry, deliberately separate from anything that draws. The renderer needs these numbers, the
 * hit test needs the same numbers, and a test needs them with no graphics context. Two implementations
 * of "where is that knob" is how a click lands next to the control it appears to be on.
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

/** One port per cell, sitting at the cell's centre so a cable meets it on a grid line. */
export const PORT_ROWS_PER_PORT = 1;
export const PORT_RADIUS = 4;
/** How far from a socket a click still counts, in patch units at 100% zoom. */
export const PORT_HIT_RADIUS = 9;

/** A knob with its label: two cells by two cells. */
export const KNOB_COLS = 2;
export const KNOB_ROWS = 2;
export const KNOB_CELL_WIDTH = KNOB_COLS * CELL;
export const KNOB_CELL_HEIGHT = KNOB_ROWS * CELL;
export const KNOB_RADIUS = 16;
export const KNOB_HIT_RADIUS = KNOB_RADIUS + 4;

/** Narrowest a module gets: enough for a title and a port column either side. */
export const MIN_COLS = 3;

/**
 * How many controls a node shows on its face.
 *
 * A wavetable oscillator has twenty-odd parameters and a face the size of a business card, so it can
 * only show a few. Which few the engine declares with the `primary` flag; this is the ceiling on how
 * many of them fit.
 */
export const MAX_FACE_CONTROLS = 4;

/** Which border of the module a socket sits on, and so which way a cable meets it. */
export type PortEdge = "left" | "right" | "bottom";

export interface PortLayout {
  port: PortDesc;
  x: number;
  y: number;
  side: "input" | "output";
  edge: PortEdge;
}

export interface ControlLayout {
  param: ParamDesc;
  /**
   * The implicit port a cable dropped on this knob connects to, or null when the parameter cannot be
   * modulated. This is how modulation is patched: onto the control it modulates, not onto a separate
   * socket beside it.
   */
  modulationPort: string | null;
  /** Centre of the knob. */
  x: number;
  y: number;
  radius: number;
  /** Baseline of the label under it. */
  labelY: number;
}

/**
 * A wave picture on the face, for a module that can draw itself (`flags.previewsWave`).
 *
 * It takes one of the face's control slots rather than being added beside them, so a module that gains
 * a display does not get wider; it shows one fewer knob. A node's width is how a patch stays legible,
 * and a picture earns its place against a knob rather than for free.
 */
export interface DisplayLayout {
  /** Top-left of the panel. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NodeLayout {
  /** Size in grid cells. The pixel size is these times `CELL`, and never anything else. */
  cols: number;
  rows: number;
  width: number;
  height: number;
  inputs: PortLayout[];
  outputs: PortLayout[];
  controls: ControlLayout[];
  /** The wave panel, or null for the modules that have no waveform to show, which is most of them. */
  display: DisplayLayout | null;
}

export interface NodeLayoutOptions {
  maxControls?: number;
}

/** The parameters a node puts on its face: the ones meant to be moved while it runs. */
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

/** The panel's own size inside its 2x2 slot: shorter than a knob, leaving the label row clear. */
export const DISPLAY_WIDTH = KNOB_CELL_WIDTH - 6;
export const DISPLAY_HEIGHT = 32;

/**
 * Lays out one node.
 *
 * Implicit modulation ports never appear in the port columns. There is one per modulatable parameter,
 * and a wavetable oscillator has twenty-odd, so giving each a socket down the side makes the node
 * taller than the patch it belongs to and unreadable at any zoom. The ones whose knob is on the face
 * get a socket on the bottom border directly under that knob, which says what it is for without a
 * label and adds no height; the rest are reached by dropping a cable on the knob.
 */
export function measureNode(
  descriptor: ModuleDescriptor,
  options: NodeLayoutOptions = {},
): NodeLayout {
  const inputs = descriptor.inputs.filter((p) => !p.implicit);
  const outputs = descriptor.outputs;
  const wave = descriptor.flags.previewsWave;
  const slots = options.maxControls ?? MAX_FACE_CONTROLS;
  const controls = faceParams(descriptor, wave ? slots - 1 : slots);

  // Rows: the header, then whichever column needs more. A module with six ports and one knob is six
  // rows of ports tall; one with two ports and four knobs is a knob tall.
  const portRows = Math.max(inputs.length, outputs.length) * PORT_ROWS_PER_PORT;
  const controlRows = controls.length > 0 || wave ? KNOB_ROWS : 0;
  const bodyRows = Math.max(portRows, controlRows, 1);
  const rows = HEADER_ROWS + bodyRows;

  // Columns: the face slots, plus a cell of margin either side so a knob never touches a port.
  const faceSlots = controls.length + (wave ? 1 : 0);
  const controlCols = faceSlots * KNOB_COLS;
  const cols = Math.max(MIN_COLS, controlCols + 2);

  const width = cols * CELL;
  const height = rows * CELL;

  const place = (ports: PortDesc[], side: "input" | "output"): PortLayout[] =>
    ports.map((port, i) => ({
      port,
      x: side === "input" ? 0 : width,
      // The centre of its cell, so every socket sits on a half-cell line and a cable between two
      // modules an integer number of cells apart runs exactly horizontally.
      y: HEADER_HEIGHT + (i + 0.5) * CELL,
      side,
      edge: side === "input" ? "left" : "right",
    }));

  // Centred as a group so a node with one knob has it in the middle rather than pinned left.
  const controlsLeft = ((cols - controlCols) / 2) * CELL;
  const controlsTop = HEADER_HEIGHT + ((bodyRows - controlRows) / 2) * CELL;
  const controlX = (i: number): number =>
    // Shifted one slot right when a display holds the first one.
    controlsLeft + (i + (wave ? 1 : 0) + 0.5) * KNOB_CELL_WIDTH;

  // The socket under each knob: the descriptor's own implicit port for that param, on the border.
  const underKnobs: PortLayout[] = [];
  controls.forEach((param, i) => {
    const port = descriptor.inputs.find(
      (p) => p.implicit && p.param === param.id,
    );
    if (port === undefined) return;
    underKnobs.push({
      port,
      x: controlX(i),
      y: height,
      side: "input",
      edge: "bottom",
    });
  });

  return {
    cols,
    rows,
    width,
    height,
    inputs: [...place(inputs, "input"), ...underKnobs],
    outputs: place(outputs, "output"),
    display: !wave
      ? null
      : {
          x: controlsLeft + (KNOB_CELL_WIDTH - DISPLAY_WIDTH) / 2,
          // Centred on the same line as the knob faces beside it, so the row reads as one row.
          y: controlsTop + CELL * 0.5 + 2 - DISPLAY_HEIGHT / 2,
          width: DISPLAY_WIDTH,
          height: DISPLAY_HEIGHT,
        },
    controls: controls.map((param, i) => ({
      param,
      modulationPort: param.flags.modulatable ? `param:${param.id}` : null,
      x: controlX(i),
      // In the upper of its two cells, leaving the lower one for the label.
      y: controlsTop + CELL * 0.5 + 2,
      radius: KNOB_RADIUS,
      labelY: controlsTop + KNOB_CELL_HEIGHT - 8,
    })),
  };
}

export interface Point {
  x: number;
  y: number;
}

export function hitNode(
  point: Point,
  origin: Point,
  layout: NodeLayout,
): boolean {
  return (
    point.x >= origin.x &&
    point.x <= origin.x + layout.width &&
    point.y >= origin.y &&
    point.y <= origin.y + layout.height
  );
}

/**
 * The port nearest a point, within the grab radius, or null.
 *
 * Nearest rather than first: sockets sit close together and a generous grab radius makes several
 * overlap, so taking the first match would sometimes connect the neighbour of the one aimed at.
 */
export function hitPort(
  point: Point,
  origin: Point,
  layout: NodeLayout,
  radius = PORT_HIT_RADIUS,
): PortLayout | null {
  let best: PortLayout | null = null;
  let bestDistance = radius * radius;
  for (const port of [...layout.inputs, ...layout.outputs]) {
    const dx = point.x - (origin.x + port.x);
    const dy = point.y - (origin.y + port.y);
    const distance = dx * dx + dy * dy;
    if (distance <= bestDistance) {
      best = port;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The knob under a point, or null.
 *
 * Checked before the node body, so dragging a knob beats dragging the node, and checked when a cable is
 * released, so dropping one on a control patches its modulation.
 */
export function hitControl(
  point: Point,
  origin: Point,
  layout: NodeLayout,
): ControlLayout | null {
  for (const control of layout.controls) {
    const dx = point.x - (origin.x + control.x);
    const dy = point.y - (origin.y + control.y);
    if (dx * dx + dy * dy <= KNOB_HIT_RADIUS * KNOB_HIT_RADIUS) return control;
  }
  return null;
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

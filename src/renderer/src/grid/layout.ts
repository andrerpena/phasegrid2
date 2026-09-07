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

export const HEADER_HEIGHT = 20;
export const PORT_SPACING = 18;
export const PORT_RADIUS = 4;
/** How far from a socket a click still counts, in patch units at 100% zoom. */
export const PORT_HIT_RADIUS = 9;
export const NODE_PADDING = 8;
export const NODE_MIN_WIDTH = 96;

export const KNOB_RADIUS = 17;
/** Room for the knob, its value arc and the label beneath it. */
export const KNOB_CELL_WIDTH = 50;
export const KNOB_CELL_HEIGHT = 56;
export const KNOB_HIT_RADIUS = KNOB_RADIUS + 4;

/**
 * How many controls a node shows on its face.
 *
 * A wavetable oscillator has twenty-odd parameters and a face the size of a business card. Bitwig's
 * answer is that a module shows its performance controls and nothing else, so this shows the
 * modulatable ones — the parameters meant to be moved while the patch runs — up to this many, and the
 * inspector holds the full set. Which parameters those are is the module's decision, expressed by the
 * order it declares them in.
 */
export const MAX_FACE_CONTROLS = 4;

export interface PortLayout {
  port: PortDesc;
  x: number;
  y: number;
  side: "input" | "output";
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

export interface NodeLayout {
  width: number;
  height: number;
  inputs: PortLayout[];
  outputs: PortLayout[];
  controls: ControlLayout[];
}

export interface NodeLayoutOptions {
  maxControls?: number;
}

/** The parameters a node puts on its face: the ones meant to be moved while it runs. */
export function faceParams(
  descriptor: ModuleDescriptor,
  max = MAX_FACE_CONTROLS,
): ParamDesc[] {
  return descriptor.params
    .filter((p) => !p.flags.hidden && p.flags.modulatable && !p.flags.enum)
    .slice(0, max);
}

/**
 * Lays out one node.
 *
 * Implicit modulation ports never appear in the port columns. There is one per modulatable parameter,
 * and a wavetable oscillator has twenty-odd, so giving each a socket makes the node taller than the
 * patch it belongs to and unreadable at any zoom. A cable is dropped on the knob instead, which is both
 * more compact and closer to what the gesture means: you are modulating that control.
 */
export function measureNode(
  descriptor: ModuleDescriptor,
  options: NodeLayoutOptions = {},
): NodeLayout {
  const inputs = descriptor.inputs.filter((p) => !p.implicit);
  const outputs = descriptor.outputs;
  const controls = faceParams(
    descriptor,
    options.maxControls ?? MAX_FACE_CONTROLS,
  );

  const portRows = Math.max(inputs.length, outputs.length);
  const portsHeight = portRows * PORT_SPACING;
  const controlsHeight = controls.length > 0 ? KNOB_CELL_HEIGHT : 0;
  // The body is as tall as whichever needs more room. A module with six ports and one knob is six ports
  // tall; one with two ports and four knobs is a knob tall.
  const bodyHeight = Math.max(portsHeight, controlsHeight) + NODE_PADDING;

  // Wide enough for its controls, plus the port columns either side of them.
  const controlsWidth = controls.length * KNOB_CELL_WIDTH;
  const width = Math.max(NODE_MIN_WIDTH, controlsWidth + NODE_PADDING * 4);
  const height = HEADER_HEIGHT + bodyHeight;

  const place = (ports: PortDesc[], side: "input" | "output"): PortLayout[] =>
    ports.map((port, i) => ({
      port,
      x: side === "input" ? 0 : width,
      y: HEADER_HEIGHT + i * PORT_SPACING + PORT_SPACING / 2,
      side,
    }));

  // Centred as a group, so a node with one knob has it in the middle rather than pinned left.
  const controlsLeft = (width - controlsWidth) / 2;
  const controlsTop = HEADER_HEIGHT + (bodyHeight - controlsHeight) / 2;

  return {
    width,
    height,
    inputs: place(inputs, "input"),
    outputs: place(outputs, "output"),
    controls: controls.map((param, i) => ({
      param,
      modulationPort: param.flags.modulatable ? `param:${param.id}` : null,
      x: controlsLeft + i * KNOB_CELL_WIDTH + KNOB_CELL_WIDTH / 2,
      y: controlsTop + KNOB_RADIUS + 4,
      radius: KNOB_RADIUS,
      labelY: controlsTop + KNOB_CELL_HEIGHT - 6,
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

export function snap(value: number, step: number): number {
  return step > 0 ? Math.round(value / step) * step : value;
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

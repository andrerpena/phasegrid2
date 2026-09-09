import {
  type ModuleDescriptor,
  type ParamDesc,
  type PortDesc,
  resolveFaceToken,
} from "@shared/protocol/catalog";
import {
  CELL,
  faceParams,
  KNOB_COLS,
  KNOB_HIT_RADIUS,
  KNOB_RADIUS,
  KNOB_ROWS,
  MAX_FACE_CONTROLS,
  MIN_COLS,
  PORT_HIT_RADIUS,
  type Point,
  TILE_GUTTER,
  TITLE_ROWS,
} from "./layout";

/**
 * A module's face, as blocks on a grid of cells.
 *
 * A module is a rectangle of uniform cells, and what it wears is a composition of blocks -- a jack,
 * a knob, a wave panel, a scope, a readout, a meter -- each covering a whole number of them, the way a hardware panel is a grid
 * of tiles. There is no table here of how any particular module looks. The engine says which blocks
 * and where (`descriptor.face`, rows of tokens in the manner of CSS `grid-template-areas`), and a
 * module that says nothing gets a face composed by rule from its ports and its primary params. The
 * only thing added here is the title block: one row across the top, above the rows the engine
 * declared, so a module's grid is the title's row and then the face's.
 *
 * Pure geometry, separate from anything that draws. The renderer needs these numbers, the hit test
 * needs the same numbers, the minimap and the automation API need the footprint, and a test needs
 * all of it with no graphics context. Two implementations of "where is that knob" is how a click
 * lands next to the control it appears to be on.
 */

/** The way a cable leaves a socket: which side of the socket the curve sets off from. */
export type Facing = "left" | "right" | "up" | "down";

/**
 * A place a cable can plug in, in patch units from the node's top left.
 *
 * Every jack has one, and so does every knob that can be modulated: the socket for the implicit
 * `param:<id>` port sits at the knob's foot, so the thing a cable modulates is the thing it is drawn
 * into.
 */
export interface Socket {
  port: PortDesc;
  side: "input" | "output";
  facing: Facing;
  x: number;
  y: number;
}

/** What every block has: its cells, and the rectangle those cells cover. */
export interface BlockBase {
  /** The face token that placed it: a port id, a param id, `wave`, `scope`, `value` or `meter`; `title` for the title. Unique on a face. */
  name: string;
  /** Cells on the module's grid, whose row 0 is the title's; the face the engine declared starts at `TITLE_ROWS`. */
  col: number;
  row: number;
  cols: number;
  rows: number;
  /** Top left, in patch units from the node's top left: the cells times `CELL`. */
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The title: one row across the module, the block the face language does not describe because every
 * module has one. What it says is the module's label, which is the document's and not the face's,
 * so the node supplies it when it builds the block.
 */
export interface TitleBlock extends BlockBase {
  kind: "title";
}

export interface JackBlock extends BlockBase {
  kind: "jack";
  socket: Socket;
}

export interface KnobBlock extends BlockBase {
  kind: "knob";
  param: ParamDesc;
  /**
   * The implicit port a cable dropped on this knob connects to, or null when the parameter cannot be
   * modulated. This is how modulation is patched: onto the control it modulates, not onto a separate
   * socket beside it.
   */
  modulationPort: string | null;
  socket: Socket | null;
  /** Centre of the knob itself. */
  centre: Point;
  radius: number;
  /** Where the label goes, under the knob. */
  labelY: number;
}

/** A screen: the tile itself, drawn in the screen's colour rather than a key's, with the picture on it. */
export interface Panel {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WaveBlock extends BlockBase {
  kind: "wave";
  panel: Panel;
}

/**
 * The scope: a screen like the wave's, showing not what the module would play but what is on the
 * wire into it, as the engine publishes it. Same geometry, different source, so the two stay two
 * kinds: a node routes a picture to one and a trace to the other.
 */
export interface ScopeBlock extends BlockBase {
  kind: "scope";
  panel: Panel;
}

/**
 * The readout: the last value on the wire, as a number. Not a screen -- it is text on an ordinary
 * tile -- so it has no panel; the block's own rectangle is where the number goes.
 */
export interface ValueBlock extends BlockBase {
  kind: "value";
}

/**
 * The level meter: a bar per channel with the held peak over it. A screen in shape but not in kind --
 * it draws bars on an ordinary tile rather than a picture of the signal.
 */
export interface MeterBlock extends BlockBase {
  kind: "meter";
}

export type Block =
  | TitleBlock
  | JackBlock
  | KnobBlock
  | WaveBlock
  | ScopeBlock
  | ValueBlock
  | MeterBlock;

export interface Face {
  /** Size in grid cells, the title's row included. The pixel size is these times `CELL` and nothing else. */
  cols: number;
  rows: number;
  width: number;
  height: number;
  /** Every block, the title first, then the face's in reading order. */
  blocks: Block[];
  title: TitleBlock;
  jacks: JackBlock[];
  knobs: KnobBlock[];
  wave: WaveBlock | null;
  scope: ScopeBlock | null;
  /** Named for what it does rather than for its token: `face.value` would read as a number. */
  readout: ValueBlock | null;
  meter: MeterBlock | null;
  /** Every place a cable can plug in: the jacks, and the sockets at the knobs' feet. */
  sockets: Socket[];
}

/** A block's least size, in cells. A jack fits a cell; a knob needs its label; a wave needs room to read. */
export const JACK_CELLS = 1;
export const KNOB_MIN_CELLS = 2;
export const WAVE_MIN_CELLS = 2;
export const SCOPE_MIN_CELLS = 2;
/** A readout needs width for its digits, but one cell of height is a line of text. */
export const VALUE_MIN_COLS = 2;
/** A meter needs two cells each way: a bar per channel, and width enough to read a level along. */
export const METER_MIN_CELLS = 2;
/** The wave block a composed face gives a module: wider than tall, the shape of a scope screen. */
export const WAVE_COLS = 3;
export const WAVE_ROWS = 2;
/** The scope a composed face gives a module: the same screen, wider still, since it is the whole point of the module. */
export const SCOPE_COLS = 4;
export const SCOPE_ROWS = 2;
/** The readout a composed face gives a module: as tall as the row it shares with the knobs. */
export const VALUE_COLS = 3;
export const VALUE_ROWS = 2;
/** The meter a composed face gives a module: as tall as the row it shares, wide enough to read. */
export const METER_COLS = 3;
export const METER_ROWS = 2;
/** The face token the title block answers to, so a script can ask for it like any other. */
export const TITLE_NAME = "title";

/** A screen is its tile: the picture goes right to the tile's edge. */
const PANEL_INSET = TILE_GUTTER;

/** The screen a wave or a scope draws on: its block, less the gutter. */
function panelOf(base: BlockBase): Panel {
  return {
    x: base.x + PANEL_INSET,
    y: base.y + PANEL_INSET,
    width: base.width - 2 * PANEL_INSET,
    height: base.height - 2 * PANEL_INSET,
  };
}

/**
 * Where a jack's socket sits in its tile: below the middle, leaving the top of the tile for the
 * port's name. The socket is inside the tile, never on the module's border, so a jack reads as a key
 * with a hole in it rather than a ring hanging off the edge.
 */
export const JACK_SOCKET_DROP = 3;
/** Baseline of a jack's name, from the top of its tile. */
export const JACK_LABEL_Y = 8;

/** A knob's centre sits this far down its tile, and this far left of the tile's middle, at scale 1. */
export const KNOB_CENTRE_Y = 18;
export const KNOB_SHIFT = 4;
/** The modulation socket's centre, in from the tile's bottom right corner, at scale 1. */
export const KNOB_SOCKET_INSET = 8;

/** One resolved cell of the face grid before it is turned into blocks. */
type Cell =
  | { kind: "empty" }
  | { kind: "wave" }
  | { kind: "scope" }
  | { kind: "value" }
  | { kind: "meter" }
  | { kind: "input"; port: PortDesc }
  | { kind: "output"; port: PortDesc }
  | { kind: "param"; param: ParamDesc };

/** The token that would have placed a cell: what a block is called, and what a script asks for. */
function nameOf(cell: Exclude<Cell, { kind: "empty" }>): string {
  switch (cell.kind) {
    case "wave":
      return "wave";
    case "scope":
      return "scope";
    case "value":
      return "value";
    case "meter":
      return "meter";
    case "input":
    case "output":
      return cell.port.id;
    case "param":
      return cell.param.id;
  }
}

/** Identity of a cell for the areas algorithm: two cells of one block share this. */
function keyOf(cell: Exclude<Cell, { kind: "empty" }>): string {
  return `${cell.kind}:${nameOf(cell)}`;
}

/**
 * Turns the engine's rows of tokens into cells, or throws.
 *
 * The engine's registry has already refused a face that names nothing, so a throw here means the
 * catalogue and this code disagree about the language, which is worth failing loudly over rather
 * than drawing a node with a hole in it.
 */
function cellOf(token: string, descriptor: ModuleDescriptor): Cell {
  const resolved = resolveFaceToken(descriptor, token);
  if (resolved === null)
    throw new Error(`${descriptor.id}: face token \`${token}\` names nothing`);
  if (resolved.kind === "empty") return { kind: "empty" };
  if (resolved.kind === "wave") {
    if (!descriptor.flags.previewsWave)
      throw new Error(
        `${descriptor.id}: face names \`wave\` but the module cannot preview`,
      );
    return { kind: "wave" };
  }
  if (resolved.kind === "scope") {
    if (!descriptor.flags.publishesScope)
      throw new Error(
        `${descriptor.id}: face names \`scope\` but the module publishes none`,
      );
    return { kind: "scope" };
  }
  if (resolved.kind === "value") {
    if (!descriptor.flags.publishesValue)
      throw new Error(
        `${descriptor.id}: face names \`value\` but the module publishes none`,
      );
    return { kind: "value" };
  }
  if (resolved.kind === "meter") {
    if (!descriptor.flags.publishesMeter)
      throw new Error(
        `${descriptor.id}: face names \`meter\` but the module publishes none`,
      );
    return { kind: "meter" };
  }
  if (resolved.kind === "param") {
    const param = descriptor.params.find((p) => p.id === resolved.id);
    if (param === undefined)
      throw new Error(`${descriptor.id}: no param ${resolved.id}`);
    return { kind: "param", param };
  }
  const list =
    resolved.kind === "input" ? descriptor.inputs : descriptor.outputs;
  const port = list.find((p) => p.id === resolved.id);
  if (port === undefined)
    throw new Error(`${descriptor.id}: no ${resolved.kind} ${resolved.id}`);
  return { kind: resolved.kind, port };
}

function cellsOf(
  rows: readonly (readonly string[])[],
  descriptor: ModuleDescriptor,
): Cell[][] {
  return rows.map((row) => row.map((token) => cellOf(token, descriptor)));
}

/**
 * The cells a module with no declared face gets: the template every module used to wear.
 *
 * Inputs down the left column, outputs down the right, and between them the primary knobs in a row
 * of two-by-two blocks, with the screens first when the module has any -- the scope, the wave, the
 * readout. A module with six ports and one knob is six rows tall; one with two ports and four knobs
 * is a knob tall.
 */
function defaultCells(descriptor: ModuleDescriptor): Cell[][] {
  const inputs = descriptor.inputs.filter((p) => !p.implicit);
  const outputs = descriptor.outputs;
  const wave = descriptor.flags.previewsWave;
  const scope = descriptor.flags.publishesScope;
  const readout = descriptor.flags.publishesValue;
  const meter = descriptor.flags.publishesMeter;
  const screens =
    Number(wave) + Number(scope) + Number(readout) + Number(meter);
  const knobs = faceParams(descriptor, MAX_FACE_CONTROLS - screens);

  const middleCols =
    knobs.length * KNOB_COLS +
    (wave ? WAVE_COLS : 0) +
    (scope ? SCOPE_COLS : 0) +
    (readout ? VALUE_COLS : 0) +
    (meter ? METER_COLS : 0);
  const cols = Math.max(MIN_COLS, middleCols + 2);
  const portRows = Math.max(inputs.length, outputs.length);
  const middleRows = knobs.length > 0 || screens > 0 ? KNOB_ROWS : 0;
  const rows = Math.max(portRows, middleRows, 1);

  const grid: Cell[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, (): Cell => ({ kind: "empty" })),
  );
  inputs.forEach((port, i) => {
    grid[i][0] = { kind: "input", port };
  });
  outputs.forEach((port, i) => {
    grid[i][cols - 1] = { kind: "output", port };
  });

  // Centred as a group, so a node with one knob has it in the middle rather than pinned left.
  const top = Math.floor((rows - middleRows) / 2);
  let col = Math.floor((cols - middleCols) / 2);
  const fill = (cell: Cell, w: number, h: number) => {
    for (let r = 0; r < h; r++)
      for (let c = 0; c < w; c++) grid[top + r][col + c] = cell;
    col += w;
  };
  if (scope) fill({ kind: "scope" }, SCOPE_COLS, SCOPE_ROWS);
  if (wave) fill({ kind: "wave" }, WAVE_COLS, WAVE_ROWS);
  if (readout) fill({ kind: "value" }, VALUE_COLS, VALUE_ROWS);
  if (meter) fill({ kind: "meter" }, METER_COLS, METER_ROWS);
  for (const param of knobs)
    fill({ kind: "param", param }, KNOB_COLS, KNOB_ROWS);
  return grid;
}

interface Area {
  cell: Exclude<Cell, { kind: "empty" }>;
  minRow: number;
  minCol: number;
  maxRow: number;
  maxCol: number;
  count: number;
}

/**
 * Cells into blocks: the `grid-template-areas` rule. Every distinct thing's cells must fill their
 * own bounding box, so a block is always a rectangle, and every thing appears at most once.
 */
function placeBlocks(cells: Cell[][], descriptor: ModuleDescriptor): Face {
  const gridRows = cells.length;
  const cols = Math.max(...cells.map((row) => row.length));
  if (gridRows === 0 || cols <= 0)
    throw new Error(`${descriptor.id}: a face needs at least one cell`);

  const areas = new Map<string, Area>();
  cells.forEach((row, r) => {
    row.forEach((cell, c) => {
      if (cell.kind === "empty") return;
      const key = keyOf(cell);
      const area = areas.get(key);
      if (area === undefined) {
        areas.set(key, {
          cell,
          minRow: r,
          minCol: c,
          maxRow: r,
          maxCol: c,
          count: 1,
        });
        return;
      }
      area.minRow = Math.min(area.minRow, r);
      area.minCol = Math.min(area.minCol, c);
      area.maxRow = Math.max(area.maxRow, r);
      area.maxCol = Math.max(area.maxCol, c);
      area.count++;
    });
  });

  const rows = TITLE_ROWS + gridRows;
  const width = cols * CELL;
  const height = rows * CELL;
  const title: TitleBlock = {
    kind: "title",
    name: TITLE_NAME,
    col: 0,
    row: 0,
    cols,
    rows: TITLE_ROWS,
    x: 0,
    y: 0,
    width,
    height: TITLE_ROWS * CELL,
  };
  const blocks: Block[] = [];

  for (const area of areas.values()) {
    const blockRows = area.maxRow - area.minRow + 1;
    const blockCols = area.maxCol - area.minCol + 1;
    const name = nameOf(area.cell);
    if (area.count !== blockRows * blockCols)
      throw new Error(
        `${descriptor.id}: face block \`${name}\` is not a rectangle`,
      );
    const base: BlockBase = {
      name,
      col: area.minCol,
      row: TITLE_ROWS + area.minRow,
      cols: blockCols,
      rows: blockRows,
      x: area.minCol * CELL,
      y: (TITLE_ROWS + area.minRow) * CELL,
      width: blockCols * CELL,
      height: blockRows * CELL,
    };
    switch (area.cell.kind) {
      case "input":
      case "output": {
        const side = area.cell.kind;
        blocks.push({
          ...base,
          kind: "jack",
          socket: jackSocket(area.cell.port, side, base, cols, rows),
        });
        break;
      }
      case "param": {
        if (blockRows < KNOB_MIN_CELLS || blockCols < KNOB_MIN_CELLS)
          throw new Error(
            `${descriptor.id}: face gives \`${name}\` less than two cells by two`,
          );
        const param = area.cell.param;
        // Everything scales with the block, from the 2x2 knob every composed face uses. Everything
        // stays inside the tile: the knob and its arc in the upper left, the label under them, and
        // the modulation socket tucked into the bottom right corner, clear of both.
        const scale = Math.min(blockCols, blockRows) / KNOB_MIN_CELLS;
        const centre = {
          x: base.x + base.width / 2 - KNOB_SHIFT * scale,
          y: base.y + KNOB_CENTRE_Y * scale,
        };
        const modulation = descriptor.inputs.find(
          (p) => p.implicit && p.param === param.id,
        );
        blocks.push({
          ...base,
          kind: "knob",
          param,
          modulationPort: modulation?.id ?? null,
          centre,
          radius: KNOB_RADIUS * scale,
          labelY: base.y + base.height - 5,
          // The socket in the tile's bottom right corner, facing down so its cable comes in from below
          // without crossing the knob or the label.
          socket:
            modulation === undefined
              ? null
              : {
                  port: modulation,
                  side: "input",
                  facing: "down",
                  x: base.x + base.width - KNOB_SOCKET_INSET * scale,
                  y: base.y + base.height - KNOB_SOCKET_INSET * scale,
                },
        });
        break;
      }
      case "wave":
        if (blockRows < WAVE_MIN_CELLS || blockCols < WAVE_MIN_CELLS)
          throw new Error(
            `${descriptor.id}: face gives \`wave\` less than two cells by two`,
          );
        blocks.push({ ...base, kind: "wave", panel: panelOf(base) });
        break;
      case "scope":
        if (blockRows < SCOPE_MIN_CELLS || blockCols < SCOPE_MIN_CELLS)
          throw new Error(
            `${descriptor.id}: face gives \`scope\` less than two cells by two`,
          );
        blocks.push({ ...base, kind: "scope", panel: panelOf(base) });
        break;
      case "value":
        if (blockCols < VALUE_MIN_COLS)
          throw new Error(
            `${descriptor.id}: face gives \`value\` less than two cells across`,
          );
        blocks.push({ ...base, kind: "value" });
        break;
      case "meter":
        if (blockRows < METER_MIN_CELLS || blockCols < METER_MIN_CELLS)
          throw new Error(
            `${descriptor.id}: face gives \`meter\` less than two cells by two`,
          );
        blocks.push({ ...base, kind: "meter" });
        break;
    }
  }

  // In reading order, so a script listing the face and a person looking at it agree on what comes first.
  blocks.sort((a, b) => a.row - b.row || a.col - b.col);
  blocks.unshift(title);

  const jacks = blocks.filter((b): b is JackBlock => b.kind === "jack");
  const knobs = blocks.filter((b): b is KnobBlock => b.kind === "knob");
  const waves = blocks.filter((b): b is WaveBlock => b.kind === "wave");
  const scopes = blocks.filter((b): b is ScopeBlock => b.kind === "scope");
  const readouts = blocks.filter((b): b is ValueBlock => b.kind === "value");
  const meters = blocks.filter((b): b is MeterBlock => b.kind === "meter");
  const declared = descriptor.inputs.filter((p) => !p.implicit);
  for (const port of [...declared, ...descriptor.outputs])
    if (!jacks.some((j) => j.socket.port === port))
      throw new Error(`${descriptor.id}: face leaves out port \`${port.id}\``);

  return {
    cols,
    rows,
    width,
    height,
    blocks,
    title,
    jacks,
    knobs,
    wave: waves[0] ?? null,
    scope: scopes[0] ?? null,
    readout: readouts[0] ?? null,
    meter: meters[0] ?? null,
    sockets: [
      ...jacks.map((j) => j.socket),
      ...knobs.flatMap((k) => (k.socket === null ? [] : [k.socket])),
    ],
  };
}

/**
 * Where a jack's socket is and which way its cable leaves.
 *
 * The socket is always inside its tile, in the middle and a little low, under the port's name. Which
 * way the cable sets off is the tile's place on the face: out to the left from the left column, to
 * the right from the right column, down from the bottom row, up from the top row, and otherwise the
 * way signal flows -- into an input from the left, out of an output to the right.
 */
function jackSocket(
  port: PortDesc,
  side: "input" | "output",
  block: BlockBase,
  cols: number,
  rows: number,
): Socket {
  const at = {
    x: block.x + block.width / 2,
    y: block.y + block.height / 2 + JACK_SOCKET_DROP,
  };
  if (block.col === 0) return { port, side, facing: "left", ...at };
  if (block.col + block.cols === cols)
    return { port, side, facing: "right", ...at };
  if (block.row + block.rows === rows)
    return { port, side, facing: "down", ...at };
  // The top row of the face, which is the row under the title.
  if (block.row === TITLE_ROWS) return { port, side, facing: "up", ...at };
  return { port, side, facing: side === "input" ? "left" : "right", ...at };
}

/** The face the engine declared, as blocks. Throws on a face the language does not allow. */
export function parseFace(
  rows: readonly (readonly string[])[],
  descriptor: ModuleDescriptor,
): Face {
  return placeBlocks(cellsOf(rows, descriptor), descriptor);
}

/** The face a module gets when it declares none: the template, as blocks. */
export function defaultFace(descriptor: ModuleDescriptor): Face {
  return placeBlocks(defaultCells(descriptor), descriptor);
}

const composed = new WeakMap<ModuleDescriptor, Face>();

/**
 * A module's face: the one it declared, or the one composed for it.
 *
 * Memoised per descriptor object, because the footprint is asked for by the bounds, the minimap, the
 * catalogue panel and the automation API, and the catalogue is replaced wholesale when it changes,
 * so a descriptor object is as good a key as its content.
 */
export function composeFace(descriptor: ModuleDescriptor): Face {
  const cached = composed.get(descriptor);
  if (cached !== undefined) return cached;
  const face =
    descriptor.face === null
      ? defaultFace(descriptor)
      : parseFace(descriptor.face, descriptor);
  composed.set(descriptor, face);
  return face;
}

export function hitFace(point: Point, origin: Point, face: Face): boolean {
  return (
    point.x >= origin.x &&
    point.x <= origin.x + face.width &&
    point.y >= origin.y &&
    point.y <= origin.y + face.height
  );
}

/**
 * The socket nearest a point, within the grab radius, or null.
 *
 * Nearest rather than first: sockets sit close together and a generous grab radius makes several
 * overlap, so taking the first match would sometimes connect the neighbour of the one aimed at.
 */
export function hitSocket(
  point: Point,
  origin: Point,
  face: Face,
  radius = PORT_HIT_RADIUS,
): Socket | null {
  let best: Socket | null = null;
  let bestDistance = radius * radius;
  for (const socket of face.sockets) {
    const dx = point.x - (origin.x + socket.x);
    const dy = point.y - (origin.y + socket.y);
    const distance = dx * dx + dy * dy;
    if (distance <= bestDistance) {
      best = socket;
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
export function hitKnob(
  point: Point,
  origin: Point,
  face: Face,
): KnobBlock | null {
  for (const knob of face.knobs) {
    const dx = point.x - (origin.x + knob.centre.x);
    const dy = point.y - (origin.y + knob.centre.y);
    const grab = knob.radius + (KNOB_HIT_RADIUS - KNOB_RADIUS);
    if (dx * dx + dy * dy <= grab * grab) return knob;
  }
  return null;
}

/** The block whose cells cover a point, the title included, or null on an empty cell. */
export function hitBlock(
  point: Point,
  origin: Point,
  face: Face,
): Block | null {
  const x = point.x - origin.x;
  const y = point.y - origin.y;
  for (const block of face.blocks)
    if (
      x >= block.x &&
      x < block.x + block.width &&
      y >= block.y &&
      y < block.y + block.height
    )
      return block;
  return null;
}

/** The socket a port has on a face, by id and side, or null. */
export function socketOf(
  face: Face,
  portId: string,
  side: "input" | "output",
): Socket | null {
  return (
    face.sockets.find((s) => s.port.id === portId && s.side === side) ?? null
  );
}

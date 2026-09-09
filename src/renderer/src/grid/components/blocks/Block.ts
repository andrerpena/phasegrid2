import { hexToNumber } from "@renderer/lib/color";
import type { GridColors } from "@renderer/theming/theme";
import type { SignalRole } from "@shared/protocol/catalog";
import type { Container, Graphics } from "pixi.js";
import type { BlockBase } from "../../face";
import { TILE_GUTTER } from "../../layout";

/**
 * What every block on a face is made of.
 *
 * A block is a Pixi component that takes its geometry from `face.ts` and its colours from here, and
 * nothing else: no store, no engine, no knowledge of which module it is on. That is what lets a story
 * show one on its own, and what makes a new kind of block one file rather than a change to the node.
 *
 * Built once and updated in place, like everything on the canvas: a patch redraws whenever a
 * parameter moves, and rebuilding graphics sixty times a second is how a canvas starts dropping frames.
 */

export interface KnobStyle {
  /** Where the arc is drawn: the module's accent, so a node reads as one thing. */
  arc: number;
  track: number;
  body: number;
  pointer: number;
  label: number;
}

export interface WaveStyle {
  /** The curve. The module's accent, so a node reads as one thing. */
  curve: number;
  /** The faint ruling behind it. */
  grid: number;
  background: number;
}

export interface BlockStyle {
  /** The module's accent, from its category. */
  accent: number;
  /** The key each block sits on, and its hairline: what makes a face read as tiles. */
  tile: { fill: number; stroke: number };
  knob: KnobStyle;
  wave: WaveStyle;
  /** A socket's colour is its signal's. */
  signal: Record<SignalRole, number>;
}

/** The blocks' colours from the theme and the module's accent, the one way every caller builds them. */
export function blockStyle(colors: GridColors, accent: number): BlockStyle {
  const signal = Object.fromEntries(
    Object.entries(colors.signal).map(([role, hex]) => [
      role,
      hexToNumber(hex),
    ]),
  ) as Record<SignalRole, number>;
  return {
    accent,
    tile: {
      fill: hexToNumber(colors.tileFill),
      stroke: hexToNumber(colors.tileStroke),
    },
    knob: {
      arc: accent,
      track: hexToNumber(colors.gridLine),
      body: hexToNumber(colors.knobBody),
      pointer: hexToNumber(colors.knobPointer),
      label: hexToNumber(colors.knobLabel),
    },
    wave: {
      curve: accent,
      grid: hexToNumber(colors.gridLine),
      background: hexToNumber(colors.background),
    },
    signal,
  };
}

/** What the node asks of any block. The rest is per kind, and the node asks by kind. */
export interface Block {
  /** Positioned by the block itself at its place on the face; the node only adds it. */
  readonly view: Container;
  setStyle(style: BlockStyle): void;
  destroy(): void;
}

/** How a socket looks right now. */
export interface SocketState {
  connected: boolean;
  hovered: boolean;
}

/** A tile's corner. */
export const TILE_RADIUS = 4;

/**
 * The tile: the filled, rounded key a block sits on, inset from its cells by the gutter.
 *
 * It is what turns a module from a frame with things floating in it into a panel of keys, the way a
 * hardware surface is: a step lighter than the node, with a hairline, and the node's own colour
 * showing between neighbours as the seam.
 */
export function drawTile(
  g: Graphics,
  block: BlockBase,
  tile: { fill: number; stroke: number },
  radius = TILE_RADIUS,
): void {
  g.clear()
    .roundRect(
      TILE_GUTTER,
      TILE_GUTTER,
      block.width - TILE_GUTTER * 2,
      block.height - TILE_GUTTER * 2,
      radius,
    )
    .fill({ color: tile.fill })
    .stroke({ width: 1, color: tile.stroke });
}

/**
 * A socket's ring: hollow when nothing is plugged in, filled when something is.
 *
 * That distinction is worth more than it looks: it is how you read at a glance which inputs of a
 * patch are actually driven. Grows a little under the pointer so a cable being dragged shows where
 * it will land.
 */
export function drawSocket(
  g: Graphics,
  radius: number,
  color: number,
  state: SocketState,
): void {
  const r = radius * (state.hovered ? 1.35 : 1);
  g.clear().circle(0, 0, r);
  if (state.connected) g.fill({ color });
  else g.fill({ color: 0x000000, alpha: 0.55 });
  g.stroke({ width: state.hovered ? 2 : 1.5, color });
}

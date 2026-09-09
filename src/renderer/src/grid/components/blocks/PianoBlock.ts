import { Container, Graphics } from "pixi.js";
import type { PianoBlock as PianoGeometry } from "../../face";
import { type Block, type BlockStyle, drawTile } from "./Block";

/**
 * A keyboard: the keys being played, lit.
 *
 * The scope says what shape a signal is, the readout what number, the meter how loud; this says
 * which notes, which is the question a note converter's pitch raises. It is a picture and nothing
 * more: it never reads the engine, and takes its keys as plain MIDI numbers, so it draws the same in
 * a story as in a patch.
 *
 * The keyboard fills its block whatever its range: more octaves means narrower keys rather than a
 * wider module, because the face is the engine's to declare and does not change with a knob.
 */

/** Which of the twelve pitch classes are black keys, C first. */
const BLACK = [
  false,
  true,
  false,
  true,
  false,
  false,
  true,
  false,
  true,
  false,
  true,
  false,
];
/** Which white key, 0..6 within its octave, a pitch class sits on or just after. */
const WHITE_INDEX = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
export const WHITE_KEYS_PER_OCTAVE = 7;
/** A black key against its white neighbours: narrower, and not as long. */
const BLACK_WIDTH = 0.6;
const BLACK_HEIGHT = 0.62;
const PADDING = 3;
/** How faint an idle white key is over the tile, and an idle black one. */
const WHITE_ALPHA = 0.35;
const BLACK_ALPHA = 0.9;

/** One key of the layout, in block pixels. */
export interface KeyRect {
  midi: number;
  black: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The MIDI note an octave starts on: C-1 is 0, so C4, middle C, is 60. */
export function octaveStart(octave: number): number {
  return 12 * (octave + 1);
}

/**
 * Where every key of `octaves` octaves from `lowMidi` goes in a block `width` by `height`.
 *
 * Whites first, then blacks, so a caller that draws in order gets the blacks on top. The white keys
 * share the width equally; a black key straddles the boundary after its white neighbour.
 */
export function keyLayout(
  lowMidi: number,
  octaves: number,
  width: number,
  height: number,
): KeyRect[] {
  const count = Math.max(1, Math.round(octaves));
  const inner = Math.max(0, width - 2 * PADDING);
  const tall = Math.max(0, height - 2 * PADDING);
  const whiteWidth = inner / (WHITE_KEYS_PER_OCTAVE * count);
  const whites: KeyRect[] = [];
  const blacks: KeyRect[] = [];
  for (let midi = lowMidi; midi < lowMidi + 12 * count; midi++) {
    const pc = ((midi % 12) + 12) % 12;
    const octave = Math.floor((midi - lowMidi) / 12);
    const white = octave * WHITE_KEYS_PER_OCTAVE + WHITE_INDEX[pc];
    if (BLACK[pc]) {
      const w = whiteWidth * BLACK_WIDTH;
      blacks.push({
        midi,
        black: true,
        x: PADDING + (white + 1) * whiteWidth - w / 2,
        y: PADDING,
        width: w,
        height: tall * BLACK_HEIGHT,
      });
    } else {
      whites.push({
        midi,
        black: false,
        x: PADDING + white * whiteWidth,
        y: PADDING,
        width: whiteWidth,
        height: tall,
      });
    }
  }
  return [...whites, ...blacks];
}

/** The keyboard's range: which octave it starts on, and how many it shows. */
export interface KeyRange {
  low: number;
  octaves: number;
}

export class PianoBlock implements Block {
  readonly view = new Container();
  private readonly tile = new Graphics();
  private readonly keys = new Graphics();
  private style: BlockStyle;
  private range: KeyRange = { low: 3, octaves: 2 };
  private held: ReadonlySet<number> = new Set();

  constructor(
    readonly geometry: PianoGeometry,
    style: BlockStyle,
  ) {
    this.style = style;
    this.view.position.set(geometry.x, geometry.y);
    this.view.addChild(this.tile, this.keys);
    drawTile(this.tile, geometry, style.tile);
    this.draw();
  }

  /** The keyboard's range, from the module's parameters. */
  setRange(range: KeyRange): void {
    this.range = range;
    this.draw();
  }

  /** The MIDI notes that are down, as the engine published them. */
  setKeys(held: readonly number[]): void {
    this.held = new Set(held);
    this.draw();
  }

  rangeOf(): KeyRange {
    return this.range;
  }

  private draw(): void {
    this.keys.clear();
    const { width, height } = this.geometry;
    const layout = keyLayout(
      octaveStart(this.range.low),
      this.range.octaves,
      width,
      height,
    );
    for (const key of layout) {
      // A lit key takes the pitch signal's colour: the colour of the cable that lit it, and one
      // that reads against both a white key and a black one, which a display module's grey accent does not.
      const lit = this.held.has(key.midi);
      const color = lit
        ? this.style.signal.pitch
        : key.black
          ? this.style.knob.body
          : this.style.knob.label;
      const alpha = lit ? 1 : key.black ? BLACK_ALPHA : WHITE_ALPHA;
      this.keys
        .rect(key.x, key.y, key.width, key.height)
        .fill({ color, alpha })
        .stroke({ color: this.style.tile.stroke, width: 1, alpha: 0.8 });
    }
  }

  setStyle(style: BlockStyle): void {
    this.style = style;
    drawTile(this.tile, this.geometry, style.tile);
    this.draw();
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}

import type { TelemetryNote } from "@shared/protocol/telemetry";
import { Container, Graphics } from "pixi.js";
import type { PianoRollBlock as PianoRollGeometry } from "../../face";
import { type Block, type BlockStyle, drawTile } from "./Block";

/**
 * A piano roll: the notes the module is playing, as a clip.
 *
 * Both axes are ranged to what is actually there, the way a clip thumbnail in a DAW is. A pattern
 * of two neighbouring notes fills the height with two lanes; one that spans the keyboard fits the
 * keyboard. Ranging to a fixed 0..127 instead would draw every ordinary pattern as a smear in the
 * middle, which tells you nothing about the one thing a piano roll is for -- the shape of the line.
 *
 * It draws nothing it works out for itself: the notes, the meter and the playhead all come from
 * the engine, which has already parsed the pattern. See `TelemetryKind.Notes`.
 */

/**
 * The fewest semitones the height may represent.
 *
 * Without a floor, a pattern on one note would give a zero-height range and a note as tall as the
 * whole panel; with one, a single note sits in the middle of a plausible register and moving it
 * moves it visibly. Roughly an octave, which is the span a phrase usually lives in.
 */
export const MIN_PITCH_SPAN = 12;
/** A note's thickness as a fraction of its lane, so neighbouring pitches stay separate bars. */
const NOTE_HEIGHT = 0.62;
/** The least a note may be drawn as, so a very short step is still a mark and not nothing. */
const MIN_NOTE_PIXELS = 2;
const MIN_NOTE_THICKNESS = 1.5;
const PADDING = 3;
const BAR_ALPHA = 0.9;
const BEAT_ALPHA = 0.35;
const PLAYHEAD_ALPHA = 0.8;

/** What the block draws: the engine's `Notes` reading, less the bookkeeping. */
export interface NotesView {
  notes: readonly TelemetryNote[];
  quartersPerCycle: number;
  quartersPerBar: number;
  phase: number;
}

/** The pitch range to draw, widened to `MIN_PITCH_SPAN` around what is there and padded by a lane. */
export function pitchRange(notes: readonly TelemetryNote[]): {
  low: number;
  high: number;
} {
  if (notes.length === 0)
    return { low: 60 - MIN_PITCH_SPAN / 2, high: 60 + MIN_PITCH_SPAN / 2 };
  let low = notes[0].pitch;
  let high = notes[0].pitch;
  for (const note of notes) {
    low = Math.min(low, note.pitch);
    high = Math.max(high, note.pitch);
  }
  // A lane either side, so the topmost and bottommost notes are not drawn against the edge.
  low -= 1;
  high += 1;
  const span = high - low;
  if (span >= MIN_PITCH_SPAN) return { low, high };
  const grow = (MIN_PITCH_SPAN - span) / 2;
  return { low: low - grow, high: high + grow };
}

export class PianoRollBlock implements Block {
  readonly view = new Container();
  private readonly tile = new Graphics();
  private readonly grid = new Graphics();
  private readonly bars = new Graphics();
  private readonly playhead = new Graphics();
  private style: BlockStyle;
  private reading: NotesView | null = null;

  constructor(
    readonly geometry: PianoRollGeometry,
    style: BlockStyle,
  ) {
    this.style = style;
    this.view.position.set(geometry.x, geometry.y);
    // Drawn in the panel's own coordinates, like the scope: the children carry the offset so every
    // number below is measured from the corner of the screen rather than the corner of the cell.
    for (const g of [this.grid, this.bars, this.playhead])
      g.position.set(
        geometry.panel.x - geometry.x,
        geometry.panel.y - geometry.y,
      );
    this.view.addChild(this.tile, this.grid, this.bars, this.playhead);
    this.drawTileOnly();
    this.drawContents();
  }

  /** The window the module is playing, as the engine published it. */
  setNotes(reading: NotesView): void {
    this.reading = reading;
    this.drawContents();
  }

  private drawTileOnly(): void {
    // The screen's own ground, not a tile: a piano roll is a picture, and the rules it wants are
    // the project's meter rather than the fixed divisions `drawScreen` rules.
    drawTile(this.tile, this.geometry, {
      fill: this.style.wave.background,
      stroke: this.style.tile.stroke,
    });
  }

  private drawContents(): void {
    this.grid.clear();
    this.bars.clear();
    this.playhead.clear();
    const { width, height } = this.geometry.panel;
    const left = PADDING;
    const top = PADDING;
    const inner = width - PADDING * 2;
    const tall = height - PADDING * 2;
    if (this.reading === null || inner <= 0 || tall <= 0) return;
    const { notes, quartersPerCycle, quartersPerBar, phase } = this.reading;

    // The grid is the project's meter, not a fixed number of columns: a cycle of one bar in 4/4 is
    // ruled in four and the same cycle in 6/8 in three. The engine reads it off the transport, so
    // the picture and the notes can never disagree about where a bar is.
    if (quartersPerCycle > 0) {
      for (let q = 1; q < quartersPerCycle; q++) {
        const at = Math.round(left + (q / quartersPerCycle) * inner) + 0.5;
        const onBar = quartersPerBar > 0 && q % quartersPerBar === 0;
        this.grid
          .moveTo(at, top)
          .lineTo(at, top + tall)
          .stroke({
            width: 1,
            color: this.style.wave.grid,
            alpha: onBar ? BAR_ALPHA : BEAT_ALPHA,
          });
      }
    }

    const { low, high } = pitchRange(notes);
    const span = high - low;
    const lane = span > 0 ? tall / span : tall;
    const thickness = Math.max(MIN_NOTE_THICKNESS, lane * NOTE_HEIGHT);
    for (const note of notes) {
      const start = left + Math.max(0, Math.min(1, note.start)) * inner;
      const room = left + inner - start;
      if (room <= 0) continue;
      const noteWidth = Math.min(
        room,
        Math.max(MIN_NOTE_PIXELS, note.length * inner),
      );
      const centre = top + tall - ((note.pitch - low) / span) * tall;
      // Velocity reads as opacity, the way a clip thumbnail shows it. At this size a shorter bar
      // would read as a shorter note, so length has to stay length.
      const alpha = 0.45 + 0.55 * Math.max(0, Math.min(1, note.velocity));
      this.bars.rect(start, centre - thickness / 2, noteWidth, thickness).fill({
        color: note.sounding ? this.style.knob.pointer : this.style.wave.curve,
        alpha: note.sounding ? 1 : alpha,
      });
    }

    const at = Math.round(left + Math.max(0, Math.min(1, phase)) * inner) + 0.5;
    this.playhead
      .moveTo(at, top)
      .lineTo(at, top + tall)
      .stroke({
        width: 1,
        color: this.style.knob.pointer,
        alpha: PLAYHEAD_ALPHA,
      });
  }

  setStyle(style: BlockStyle): void {
    this.style = style;
    this.drawTileOnly();
    this.drawContents();
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}

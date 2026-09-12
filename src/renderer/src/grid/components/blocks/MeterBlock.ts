import { Container, Graphics } from "pixi.js";
import type { MeterBlock as MeterGeometry } from "../../face";
import { type Block, type BlockStyle, drawTile } from "./Block";

/**
 * A level meter: a bar per channel, the held peak riding above it, and a clip light.
 *
 * The scope says what shape a signal is and the readout says what number it is; this says how loud it
 * is, which is the question you ask on the way to the output. It is a picture and nothing more: it
 * never reads the engine, and takes its numbers as plain numbers, so it draws the same in a story as
 * in a patch.
 */

/** The range the bar spans, in decibels. Below the floor is nothing; above the ceiling is clipping. */
export const METER_FLOOR_DB = -60;
export const METER_CEILING_DB = 6;

/**
 * An amplitude as a fraction of the bar, 0 to 1.
 *
 * Decibels, not amplitude. Half of full scale is -6 dB, which is most of the way up a meter and a
 * fifth of the way up a linear bar; a linear meter spends its whole length on the loudest tenth of
 * what you can hear and leaves everything quiet indistinguishable from silence.
 */
export function meterFraction(amplitude: number): number {
  const magnitude = Math.abs(amplitude);
  if (!(magnitude > 0)) return 0;
  const db = 20 * Math.log10(magnitude);
  const span = METER_CEILING_DB - METER_FLOOR_DB;
  return Math.max(0, Math.min(1, (db - METER_FLOOR_DB) / span));
}

/** What a meter is showing: held peak, RMS and whether it has clipped, per channel. */
export interface Level {
  peak: number[];
  rms: number[];
  clipped: number[];
}

const BAR_GAP = 3;
const PADDING = 4;
/** The clip light at the end of the bars, and the gap before it. */
const CLIP_WIDTH = 4;
const CLIP_GAP = 3;
const PEAK_WIDTH = 2;

export class MeterBlock implements Block {
  readonly view = new Container();
  private readonly tile = new Graphics();
  private readonly bars = new Graphics();
  private style: BlockStyle;
  private level: Level | null = null;

  constructor(
    readonly geometry: MeterGeometry,
    style: BlockStyle,
  ) {
    this.style = style;
    this.view.position.set(geometry.x, geometry.y);
    this.view.addChild(this.tile, this.bars);
    drawTile(this.tile, geometry, style.tile);
    this.draw();
  }

  /** The level on the wire, as the engine published it. */
  setLevel(level: Level): void {
    this.level = level;
    this.draw();
  }

  private draw(): void {
    this.bars.clear();
    const channels = this.level?.rms.length ?? 2;
    if (channels === 0) return;
    const { width, height } = this.geometry;
    const left = PADDING;
    const clipX = width - PADDING - CLIP_WIDTH;
    const trackWidth = clipX - CLIP_GAP - left;
    const trackHeight =
      (height - 2 * PADDING - BAR_GAP * (channels - 1)) / channels;
    if (trackWidth <= 0 || trackHeight <= 0) return;

    for (let c = 0; c < channels; c++) {
      const y = PADDING + c * (trackHeight + BAR_GAP);
      // The track: the whole range, so an empty meter still reads as a meter rather than as nothing.
      this.bars
        .rect(left, y, trackWidth, trackHeight)
        .fill({ color: this.style.knob.track, alpha: 0.5 });

      const rms = meterFraction(this.level?.rms[c] ?? 0);
      if (rms > 0)
        this.bars
          .rect(left, y, trackWidth * rms, trackHeight)
          .fill({ color: this.style.accent });

      // The held peak as a line above the bar: where the signal got to, not where it is.
      const peak = meterFraction(this.level?.peak[c] ?? 0);
      if (peak > 0) {
        const x = Math.min(
          left + trackWidth - PEAK_WIDTH,
          left + trackWidth * peak,
        );
        this.bars
          .rect(x, y, PEAK_WIDTH, trackHeight)
          .fill({ color: this.style.knob.label });
      }

      // The clip light: lit like a lamp on a panel rather than appearing from nowhere, so its place
      // is part of the meter whether or not anything has clipped.
      const clipped = (this.level?.clipped[c] ?? 0) > 0;
      this.bars.rect(clipX, y, CLIP_WIDTH, trackHeight).fill({
        color: clipped ? this.style.signal.audio : this.style.knob.track,
        alpha: clipped ? 1 : 0.5,
      });
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

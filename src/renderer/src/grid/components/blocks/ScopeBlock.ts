import { Container, Graphics } from "pixi.js";
import type { ScopeBlock as ScopeGeometry } from "../../face";
import { type Block, type BlockStyle, drawScreen } from "./Block";

/**
 * A screen that shows what is on the wire: the window the engine publishes for a scope module, drawn
 * as it arrives, sixty times a second.
 *
 * The wave panel shows what a module would play; this shows what a module is being fed. Same
 * screen, different picture, and the difference is the whole reason there are two kinds of block: a
 * node hands a preview to one and a trace to the other and neither has to ask which it is. Like the
 * wave it is a picture and nothing more: it never reads the engine, and takes its samples as plain
 * numbers, so it draws the same in a story as in a patch.
 */

/**
 * Where to start drawing so a periodic signal holds still: the first rising zero crossing in the
 * first half of the window, or 0 when there is none.
 *
 * A scope that drew from the window's first sample would show a wave sliding across the screen at
 * whatever its period fails to divide the window by. Starting at a crossing anchors every frame to
 * the same phase. Only the first half is searched, so there is always a full `span` to draw from
 * wherever the trigger lands; a signal that never crosses (a constant, a control voltage sitting at
 * 0.7) is drawn from the start and moves as it moves, which is the right picture of it.
 */
export function triggerOffset(
  samples: ArrayLike<number>,
  span: number,
): number {
  const limit = Math.min(samples.length - span, Math.floor(samples.length / 2));
  for (let i = 1; i <= limit; i++)
    if (samples[i - 1] < 0 && samples[i] >= 0) return i;
  return 0;
}

/** A column's extent: the least and greatest sample that fell in it. */
export interface Extent {
  min: number;
  max: number;
}

/**
 * `span` samples from `from`, folded into `columns` columns, each keeping the least and greatest
 * value that landed in it.
 *
 * Not nearest-sample, which is what the wave panel does and is right for one synthesised cycle: a
 * live trace has noise in it, and picking one sample in ten out of noise draws a slow fake wave that
 * is not there. Keeping the extremes draws noise as the band it is, and a clean wave as a line,
 * because its extremes in one column are the same sample.
 */
export function resampleMinMax(
  samples: ArrayLike<number>,
  from: number,
  span: number,
  columns: number,
): Extent[] {
  const n = Math.min(span, samples.length - from);
  if (n <= 0 || columns <= 0) return [];
  const out: Extent[] = new Array(columns);
  for (let c = 0; c < columns; c++) {
    const start = from + Math.floor((c * n) / columns);
    const end = Math.max(start + 1, from + Math.floor(((c + 1) * n) / columns));
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (let i = start; i < end; i++) {
      const v = samples[i];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    out[c] = { min, max };
  }
  return out;
}

/** Roughly one column per pixel: finer buys nothing on screen and costs geometry on every redraw. */
const COLUMNS_PER_PIXEL = 1;
const LINE_WIDTH = 1.5;
/** The right channel, drawn over the left in the same colour, fainter, so a stereo signal reads as two. */
const SECOND_CHANNEL_ALPHA = 0.5;

export class ScopeBlock implements Block {
  readonly view = new Container();
  private readonly tile = new Graphics();
  private readonly rules = new Graphics();
  private readonly traces = new Graphics();
  private style: BlockStyle;
  private channels: ArrayLike<number>[] = [];

  constructor(
    readonly geometry: ScopeGeometry,
    style: BlockStyle,
  ) {
    this.style = style;
    this.view.position.set(geometry.x, geometry.y);
    for (const g of [this.rules, this.traces])
      g.position.set(
        geometry.panel.x - geometry.x,
        geometry.panel.y - geometry.y,
      );
    this.view.addChild(this.tile, this.rules, this.traces);
    this.drawStatic();
  }

  private drawStatic(): void {
    drawScreen(
      this.tile,
      this.rules,
      this.geometry,
      this.geometry.panel,
      this.style,
    );
  }

  /**
   * The window to show: one array per channel, the oldest sample first, in -1..1.
   *
   * Half the window is drawn, from the trigger, so there is always a whole span to draw wherever the
   * trigger lands. Values outside -1..1 are clamped to the panel rather than scaled to fit, as on the
   * wave: a signal past full scale should look like one.
   */
  setTrace(channels: ArrayLike<number>[]): void {
    this.channels = channels;
    this.drawTraces();
  }

  private drawTraces(): void {
    this.traces.clear();
    const first = this.channels[0];
    if (first === undefined || first.length < 2) return;
    const { width, height } = this.geometry.panel;

    const inset = LINE_WIDTH / 2 + 1;
    const top = inset;
    const bottom = height - inset;
    const mid = (top + bottom) / 2;
    const amplitude = (bottom - top) / 2;
    const columns = Math.max(2, Math.round(width * COLUMNS_PER_PIXEL));
    const span = Math.floor(first.length / 2);
    // Every channel from the same point, so left and right stay in phase with each other on screen.
    const from = triggerOffset(first, span);
    const step = (width - inset * 2) / (columns - 1);
    const yOf = (v: number) => mid - Math.max(-1, Math.min(1, v)) * amplitude;

    this.channels.forEach((samples, channel) => {
      const extents = resampleMinMax(samples, from, span, columns);
      if (extents.length === 0) return;
      // Down the maxima and back along the minima: one closed band, which is a line where the signal
      // is smooth and a filled region where it is busier than the pixels.
      for (let i = 0; i < extents.length; i++) {
        const x = inset + step * i;
        if (i === 0) this.traces.moveTo(x, yOf(extents[i].max));
        else this.traces.lineTo(x, yOf(extents[i].max));
      }
      for (let i = extents.length - 1; i >= 0; i--)
        this.traces.lineTo(inset + step * i, yOf(extents[i].min));
      this.traces.closePath().stroke({
        width: LINE_WIDTH,
        color: this.style.wave.curve,
        alpha: channel === 0 ? 1 : SECOND_CHANNEL_ALPHA,
        cap: "round",
        join: "round",
      });
    });
  }

  setStyle(style: BlockStyle): void {
    this.style = style;
    this.drawStatic();
    this.drawTraces();
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}

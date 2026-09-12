import { Container, Graphics } from "pixi.js";
import type { WaveBlock as WaveGeometry } from "../../face";
import {
  type Block,
  type BlockStyle,
  drawScreen,
  type WaveStyle,
} from "./Block";

/**
 * A panel that draws one cycle of a wave.
 *
 * It is what tells you at a glance which of four near-identical modules you are looking at. The
 * title is the thing people stop reading first, so the picture carries the identity. It is a picture
 * and nothing more: it never plays, never reads the engine, and takes its curve as plain numbers, so
 * it draws the same in a story as in a patch.
 */

/**
 * The curve, resampled to one point per column.
 *
 * Nearest sample rather than an interpolated one, which is the whole reason this is a function worth
 * testing. A square wave interpolated down to forty columns comes out as a trapezoid with visible ramps
 * on its edges, and a trapezoid is a different waveform. Nearest keeps an edge an edge.
 *
 * `columns` points span phase 0 to 1 inclusive, so a saw is drawn as the full ramp from bottom to top
 * with no reset edge: the reset happens at the cycle boundary, which is the right-hand edge of the box.
 */
export function resampleWave(
  samples: ArrayLike<number>,
  columns: number,
): number[] {
  if (samples.length === 0 || columns <= 0) return [];
  if (columns === 1) return [samples[0]];
  const out: number[] = new Array(columns);
  for (let i = 0; i < columns; i++) {
    const phase = i / (columns - 1);
    const index = Math.min(
      samples.length - 1,
      Math.round(phase * samples.length),
    );
    out[i] = samples[index];
  }
  return out;
}

/** Roughly one point per pixel: finer buys nothing on screen and costs geometry on every redraw. */
const COLUMNS_PER_PIXEL = 1;
const LINE_WIDTH = 1.5;

export class WaveBlock implements Block {
  readonly view = new Container();
  private readonly tile = new Graphics();
  private readonly rules = new Graphics();
  private readonly curve = new Graphics();
  private style: BlockStyle;
  private samples: ArrayLike<number> = [];

  constructor(
    readonly geometry: WaveGeometry,
    style: BlockStyle,
  ) {
    this.style = style;
    this.view.position.set(geometry.x, geometry.y);
    for (const g of [this.rules, this.curve])
      g.position.set(
        geometry.panel.x - geometry.x,
        geometry.panel.y - geometry.y,
      );
    this.view.addChild(this.tile, this.rules, this.curve);
    this.drawStatic();
  }

  private get waveStyle(): WaveStyle {
    return this.style.wave;
  }

  /** The screen and its ruling, which only change with the style. */
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
   * The curve to draw: one cycle, in -1..1, evenly sampled.
   *
   * Values outside that range are clamped to the panel rather than scaled to fit. A wavefolder pushes a
   * wave past 1 on purpose, and rescaling would redraw it as though nothing had happened, hiding the
   * exact thing the control was turned to do.
   */
  setWave(samples: ArrayLike<number>): void {
    this.samples = samples;
    this.drawCurve();
  }

  private drawCurve(): void {
    this.curve.clear();
    if (this.samples.length === 0) return;
    const { width, height } = this.geometry.panel;

    // Inset by the line's own half-width so a wave sitting at full scale is not clipped in half by the
    // panel edge, which is exactly where a square wave lives.
    const inset = LINE_WIDTH / 2 + 1;
    const top = inset;
    const bottom = height - inset;
    const mid = (top + bottom) / 2;
    const amplitude = (bottom - top) / 2;

    const columns = Math.max(2, Math.round(width * COLUMNS_PER_PIXEL));
    const points = resampleWave(this.samples, columns);
    for (let i = 0; i < points.length; i++) {
      const x = inset + ((width - inset * 2) * i) / (points.length - 1);
      const y = mid - Math.max(-1, Math.min(1, points[i])) * amplitude;
      if (i === 0) this.curve.moveTo(x, y);
      else this.curve.lineTo(x, y);
    }
    this.curve.stroke({
      width: LINE_WIDTH,
      color: this.waveStyle.curve,
      cap: "round",
      join: "round",
    });
  }

  setStyle(style: BlockStyle): void {
    this.style = style;
    this.drawStatic();
    this.drawCurve();
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}

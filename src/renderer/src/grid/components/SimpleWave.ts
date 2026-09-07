import { Container, Graphics } from "pixi.js";

/**
 * A small panel that draws one cycle of a wave.
 *
 * It is what tells you at a glance which of four near-identical modules you are looking at. A module
 * face has room for a title, two knobs and this, and the title is the thing people stop reading first,
 * so the picture carries the identity. It is a picture and nothing more: it never plays, never reads the
 * engine, and takes its curve as plain numbers, so it draws the same in a story as in a patch.
 *
 * Built once and updated in place, like `Knob`: a patch redraws whenever a parameter moves, and
 * rebuilding geometry on every change is how a canvas starts dropping frames.
 */

export interface SimpleWaveStyle {
  /** The curve. Usually the module's accent, so a node reads as one thing. */
  curve: number;
  /** The faint ruling behind it. */
  grid: number;
  background: number;
  border: number;
}

export interface SimpleWaveOptions {
  /** Cells of ruling behind the curve. Zero on either axis leaves that direction unruled. */
  gridDivisions?: { x: number; y: number };
  lineWidth?: number;
}

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

export class SimpleWave {
  readonly view = new Container();
  private readonly panel = new Graphics();
  private readonly rules = new Graphics();
  private readonly curve = new Graphics();
  private samples: ArrayLike<number> = [];

  constructor(
    private readonly width: number,
    private readonly height: number,
    private style: SimpleWaveStyle,
    private readonly options: SimpleWaveOptions = {},
  ) {
    this.view.addChild(this.panel, this.rules, this.curve);
    this.drawStatic();
  }

  /** Panel and ruling, which only change with the style. */
  private drawStatic(): void {
    const { width: w, height: h } = this;
    this.panel
      .clear()
      .rect(0, 0, w, h)
      .fill({ color: this.style.background })
      .stroke({ width: 1, color: this.style.border, alpha: 0.8 });

    const divisions = this.options.gridDivisions ?? { x: 4, y: 2 };
    this.rules.clear();
    for (let i = 1; i < divisions.x; i++) {
      const x = Math.round((i * w) / divisions.x) + 0.5;
      this.rules.moveTo(x, 1).lineTo(x, h - 1);
    }
    for (let i = 1; i < divisions.y; i++) {
      const y = Math.round((i * h) / divisions.y) + 0.5;
      this.rules.moveTo(1, y).lineTo(w - 1, y);
    }
    // One stroke for every rule: each `stroke()` is its own draw instruction, and a panel ruled into
    // sixteen cells would otherwise cost sixteen of them per redraw.
    this.rules.stroke({ width: 1, color: this.style.grid, alpha: 0.5 });
  }

  /**
   * The curve to draw: one cycle, in -1..1, evenly sampled.
   *
   * Values outside that range are clamped to the panel rather than scaled to fit. A wavefolder pushes a
   * wave past 1 on purpose, and rescaling would redraw it as though nothing had happened, hiding the
   * exact thing the control was turned to do.
   */
  setSamples(samples: ArrayLike<number>): void {
    this.samples = samples;
    this.drawCurve();
  }

  private drawCurve(): void {
    this.curve.clear();
    if (this.samples.length === 0) return;

    // Inset by the line's own half-width so a wave sitting at full scale is not clipped in half by the
    // panel edge, which is exactly where a square wave lives.
    const lineWidth = this.options.lineWidth ?? 1.5;
    const inset = lineWidth / 2 + 1;
    const top = inset;
    const bottom = this.height - inset;
    const mid = (top + bottom) / 2;
    const amplitude = (bottom - top) / 2;

    const columns = Math.max(2, Math.round(this.width * COLUMNS_PER_PIXEL));
    const points = resampleWave(this.samples, columns);
    for (let i = 0; i < points.length; i++) {
      const x = inset + ((this.width - inset * 2) * i) / (points.length - 1);
      const y = mid - Math.max(-1, Math.min(1, points[i])) * amplitude;
      if (i === 0) this.curve.moveTo(x, y);
      else this.curve.lineTo(x, y);
    }
    this.curve.stroke({
      width: lineWidth,
      color: this.style.curve,
      cap: "round",
      join: "round",
    });
  }

  setStyle(style: SimpleWaveStyle): void {
    this.style = style;
    this.drawStatic();
    this.drawCurve();
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}

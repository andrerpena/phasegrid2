import type { EnvelopeReading } from "@shared/protocol/telemetry";
import { Container, Graphics } from "pixi.js";
import type { AdsrBlock as AdsrGeometry } from "../../face";
import { type Block, type BlockStyle, drawScreen } from "./Block";

/**
 * The envelope picture: the shape a module's knobs describe, with a dot where it has got to.
 *
 * It draws what the engine hands it and works nothing out. The curve, the three breakpoints and the
 * playhead all arrive on a 0..1 axis (`TelemetryKind.Envelope`), computed by the module that makes
 * the sound, so the picture cannot drift away from what is heard -- and so this file has no idea what
 * an attack is. Scaling those numbers to the panel is the whole of its job.
 *
 * The sustain runs dashed between the decay's end and the release's start, because that stretch is
 * not a duration: it lasts as long as the note is held, and drawing it solid would say otherwise.
 */

const LINE_WIDTH = 1.5;
/** Roughly one point per pixel: finer buys nothing on screen and costs geometry on every redraw. */
const POINTS_PER_PIXEL = 1;
/** The dot on a breakpoint, and the larger one that follows the envelope. */
const NODE_RADIUS = 2.5;
const PLAYHEAD_RADIUS = 3;
/** Dash and gap for the sustain, in panel pixels. */
const DASH = 4;
const GAP = 3;

export class AdsrBlock implements Block {
  readonly view = new Container();
  private readonly tile = new Graphics();
  private readonly rules = new Graphics();
  private readonly curve = new Graphics();
  private readonly nodes = new Graphics();
  private readonly playhead = new Graphics();
  private style: BlockStyle;
  private reading: EnvelopeReading | null = null;

  constructor(
    readonly geometry: AdsrGeometry,
    style: BlockStyle,
  ) {
    this.style = style;
    this.view.position.set(geometry.x, geometry.y);
    for (const g of [this.rules, this.curve, this.nodes, this.playhead])
      g.position.set(
        geometry.panel.x - geometry.x,
        geometry.panel.y - geometry.y,
      );
    this.view.addChild(
      this.tile,
      this.rules,
      this.curve,
      this.nodes,
      this.playhead,
    );
    this.drawStatic();
  }

  /** The picture the engine published, or null before the first one arrives. */
  setEnvelope(reading: EnvelopeReading): void {
    this.reading = reading;
    this.draw();
  }

  /** What a script sees of the picture: enough to assert the shape without a screenshot. */
  summary(): {
    attackEnd: number;
    decayEnd: number;
    sustainEnd: number;
    sustain: number;
    playhead: { x: number; y: number } | null;
  } | null {
    if (this.reading === null) return null;
    const { attackEnd, decayEnd, sustainEnd, sustain, playhead } = this.reading;
    return { attackEnd, decayEnd, sustainEnd, sustain, playhead };
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

  /** Panel coordinates for a point of the picture: x across, y with zero at the bottom. */
  private point(x: number, y: number): { x: number; y: number } {
    const inset = LINE_WIDTH / 2 + PLAYHEAD_RADIUS;
    const { width, height } = this.geometry.panel;
    const clamped = Math.max(0, Math.min(1, y));
    return {
      x: inset + (width - inset * 2) * Math.max(0, Math.min(1, x)),
      y: height - inset - (height - inset * 2) * clamped,
    };
  }

  private draw(): void {
    this.curve.clear();
    this.nodes.clear();
    this.playhead.clear();
    const reading = this.reading;
    if (reading === null || reading.curve.length === 0) return;
    const accent = this.style.wave.curve;

    // The curve, resampled to about one point per pixel and split at the sustain so the dashed run
    // is drawn on its own rather than stroked over.
    const columns = Math.max(
      2,
      Math.round(this.geometry.panel.width * POINTS_PER_PIXEL),
    );
    let drawing = false;
    for (let i = 0; i < columns; i++) {
      const x = i / (columns - 1);
      if (x > reading.decayEnd && x < reading.sustainEnd) {
        drawing = false;
        continue;
      }
      const index = Math.min(
        reading.curve.length - 1,
        Math.round(x * (reading.curve.length - 1)),
      );
      const at = this.point(x, reading.curve[index]);
      if (drawing) this.curve.lineTo(at.x, at.y);
      else this.curve.moveTo(at.x, at.y);
      drawing = true;
    }
    this.curve.stroke({
      width: LINE_WIDTH,
      color: accent,
      cap: "round",
      join: "round",
    });

    // The sustain: dashed, because it lasts as long as the note does and not a moment of its own.
    const from = this.point(reading.decayEnd, reading.sustain);
    const to = this.point(reading.sustainEnd, reading.sustain);
    for (let x = from.x; x < to.x; x += DASH + GAP) {
      this.curve.moveTo(x, from.y).lineTo(Math.min(x + DASH, to.x), to.y);
    }
    this.curve.stroke({ width: LINE_WIDTH, color: accent, cap: "butt" });

    // The corners: where the attack tops out, where the decay lands, and where the release ends.
    for (const [x, y] of [
      [reading.attackEnd, 1],
      [reading.decayEnd, reading.sustain],
      [1, 0],
    ] as const) {
      const at = this.point(x, y);
      this.nodes.circle(at.x, at.y, NODE_RADIUS);
    }
    this.nodes.fill({ color: accent });

    if (reading.playhead === null) return;
    const at = this.point(reading.playhead.x, reading.playhead.y);
    this.playhead
      .circle(at.x, at.y, PLAYHEAD_RADIUS)
      .fill({ color: this.style.playhead });
  }

  setStyle(style: BlockStyle): void {
    this.style = style;
    this.drawStatic();
    this.draw();
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}

import { Container, Graphics, Text } from "pixi.js";
import type { ValueBlock as ValueGeometry } from "../../face";
import { type Block, type BlockStyle, drawTile } from "./Block";

/**
 * A readout: what is on the wire right now, as a number.
 *
 * The scope answers "what shape is this signal"; this answers "what is it, exactly", which is the
 * question a control voltage raises. It is text and nothing more: it never reads the engine, and takes
 * its numbers as plain numbers, so it draws the same in a story as in a patch.
 *
 * Monospaced on purpose. A number that changes sixty times a second in a proportional font shifts its
 * digits sideways as they change, and a readout that dances is one you cannot read.
 */

const MONO = '"Source Code Pro", ui-monospace, Menlo, monospace';
const FONT_SIZE = 10;
const LINE_HEIGHT = 11;
/** Left and right within this of each other are one number: a mono signal is not two readings. */
const SAME = 1e-6;

/**
 * A signal value as it is shown: always signed, and as many decimals as the width allows.
 *
 * Signals here live in -1..1, where three decimals is the useful resolution, so that is the default and
 * larger magnitudes give decimals up rather than growing the string past the tile. A signal that has
 * gone to infinity or NaN says so: that is a patch that has blown up, and a readout is exactly where
 * you would want to find out.
 */
export function formatSignal(value: number): string {
  if (Number.isNaN(value)) return "nan";
  if (!Number.isFinite(value)) return value > 0 ? "+inf" : "-inf";
  const magnitude = Math.abs(value);
  const decimals =
    magnitude < 10 ? 3 : magnitude < 100 ? 2 : magnitude < 1000 ? 1 : 0;
  // `toFixed` on -0 gives "-0.000", which is a minus sign on a signal that is simply off.
  const rounded = value === 0 ? 0 : value;
  const text = rounded.toFixed(decimals);
  return text.startsWith("-") ? text : `+${text}`;
}

/** The lines a reading draws: one when the channels agree, one per channel when they do not. */
export function readoutLines(values: readonly number[]): string[] {
  if (values.length === 0) return [];
  const [first, ...rest] = values;
  if (rest.every((v) => Math.abs(v - first) <= SAME))
    return [formatSignal(first)];
  return values.map(formatSignal);
}

export class ValueBlock implements Block {
  readonly view = new Container();
  private readonly tile = new Graphics();
  private readonly lines: Text[] = [];
  private style: BlockStyle;
  private values: number[] = [];

  constructor(
    readonly geometry: ValueGeometry,
    style: BlockStyle,
  ) {
    this.style = style;
    this.view.position.set(geometry.x, geometry.y);
    this.view.addChild(this.tile);
    drawTile(this.tile, geometry, style.tile);
    this.draw();
  }

  /** The last value on the wire, per channel, as the engine published it. */
  setValue(values: number[]): void {
    this.values = values;
    this.draw();
  }

  /**
   * Built once per line count and moved after that: a reading changes every frame, and making a new
   * `Text` sixty times a second is how a canvas starts dropping them. Two channels that drift apart
   * add a line, which happens once, not per frame.
   */
  private draw(): void {
    const texts = readoutLines(this.values);
    while (this.lines.length > texts.length) {
      const spare = this.lines.pop();
      spare?.destroy();
    }
    while (this.lines.length < texts.length) {
      const line = new Text({
        text: "",
        style: {
          fontSize: FONT_SIZE,
          fill: this.style.knob.label,
          fontFamily: MONO,
        },
      });
      line.anchor.set(0.5, 0.5);
      this.lines.push(line);
      this.view.addChild(line);
    }
    const top = (this.geometry.height - texts.length * LINE_HEIGHT) / 2;
    texts.forEach((text, i) => {
      const line = this.lines[i];
      line.text = text;
      line.position.set(this.geometry.width / 2, top + LINE_HEIGHT * (i + 0.5));
    });
  }

  setStyle(style: BlockStyle): void {
    this.style = style;
    drawTile(this.tile, this.geometry, style.tile);
    for (const line of this.lines) line.style.fill = style.knob.label;
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}

import { Container, Graphics, Text } from "pixi.js";
import type { TextBlock as TextGeometry } from "../../face";
import { type Block, type BlockStyle, drawTile } from "./Block";

/**
 * A text property, on the module's face.
 *
 * Read-only: the value is typed in the inspector or the editor, and this shows what it currently
 * is. Without it a module whose entire content is a string is a blank rectangle, and a canvas with
 * two of them on it tells you nothing about either.
 *
 * The step that is SOUNDING is drawn in the module's accent colour, in time with the music. The
 * engine says which character range that is -- it already parsed the string, so the canvas never
 * has to -- which is what lets a pattern light up as it plays without anything here understanding
 * mini-notation.
 *
 * Monospaced, and for the same reason a readout is: a pattern is a grid of steps, and a
 * proportional font makes a `~` and a `c4` different widths, so nothing lines up with what you
 * hear.
 */

const MONO = '"Source Code Pro", ui-monospace, Menlo, monospace';
const FONT_SIZE = 10;
const LINE_HEIGHT = 12;
/** Room either side of the text inside the tile, so a long pattern does not touch the edge. */
const PADDING = 5;

/** A character range of the source, as the engine numbers it. */
export interface TextHighlight {
  from: number;
  to: number;
}

/**
 * The value cut to what will fit, with an ellipsis when it does not.
 *
 * Cut at the END rather than scaled down: a pattern read at four pixels is not read at all, and
 * the beginning of a pattern is the part that says what it is.
 */
export function fitPattern(value: string, chars: number): string {
  if (chars <= 0) return "";
  if (value.length <= chars) return value;
  return chars <= 1 ? "…" : `${value.slice(0, chars - 1)}…`;
}

export class TextBlock implements Block {
  readonly view = new Container();
  private readonly tile = new Graphics();
  private readonly marks = new Graphics();
  private readonly label = new Text({
    text: "",
    style: { fontSize: FONT_SIZE },
  });
  private style: BlockStyle;
  private value = "";
  private highlights: TextHighlight[] = [];

  constructor(
    readonly geometry: TextGeometry,
    style: BlockStyle,
  ) {
    this.style = style;
    this.view.position.set(geometry.x, geometry.y);
    this.view.addChild(this.tile, this.marks, this.label);
    drawTile(this.tile, geometry, style.tile);
    this.label.anchor.set(0, 0.5);
    this.applyStyle();
    this.draw();
  }

  /** The string as the document holds it, or empty for a property nobody has set. */
  setValue(value: string): void {
    if (value === this.value) return;
    this.value = value;
    this.draw();
  }

  /** Which character ranges are sounding, from the engine's telemetry. */
  setHighlights(highlights: readonly TextHighlight[]): void {
    this.highlights = [...highlights];
    this.drawMarks();
  }

  /** Where a character sits, in the block's own coordinates. Monospaced, so this is arithmetic. */
  private charWidth(): number {
    // `Text` measures lazily and a story may draw before a font has loaded, so the advance is
    // derived from the font size rather than measured. It is exact for the metrics we ship with.
    return FONT_SIZE * 0.6;
  }

  private visibleChars(): number {
    return Math.max(
      0,
      Math.floor((this.geometry.width - PADDING * 2) / this.charWidth()),
    );
  }

  private draw(): void {
    const shown =
      this.value === "" ? (this.geometry.text.placeholder ?? "") : this.value;
    this.label.text = fitPattern(shown, this.visibleChars());
    this.label.alpha = this.value === "" ? 0.4 : 1;
    this.label.position.set(PADDING, this.geometry.height / 2);
    this.drawMarks();
  }

  /**
   * The sounding steps, as a wash behind the characters they cover.
   *
   * Behind rather than as a colour change, so a step that is playing reads at a glance without the
   * text reflowing or changing weight -- the same reason a piano roll lights a note rather than
   * relabelling it.
   */
  private drawMarks(): void {
    this.marks.clear();
    if (this.value === "") return;
    const chars = this.visibleChars();
    const width = this.charWidth();
    const top = this.geometry.height / 2 - LINE_HEIGHT / 2;
    for (const { from, to } of this.highlights) {
      const start = Math.max(0, Math.min(from, chars));
      const end = Math.max(start, Math.min(to, chars));
      if (end <= start) continue;
      this.marks
        .rect(PADDING + start * width, top, (end - start) * width, LINE_HEIGHT)
        .fill({ color: this.style.accent, alpha: 0.35 });
    }
  }

  private applyStyle(): void {
    this.label.style.fill = this.style.knob.label;
    this.label.style.fontFamily = MONO;
  }

  setStyle(style: BlockStyle): void {
    this.style = style;
    drawTile(this.tile, this.geometry, style.tile);
    this.applyStyle();
    this.drawMarks();
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}

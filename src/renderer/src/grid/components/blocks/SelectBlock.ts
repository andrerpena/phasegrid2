import { Container, Graphics, Text } from "pixi.js";
import type { SelectBlock as SelectGeometry } from "../../face";
import { type Block, type BlockStyle, drawTile, fitText } from "./Block";

/**
 * An enum's switch: the block that shows a name.
 *
 * A knob cannot draw one, which is why the face language refuses an enum on one. A list of names has
 * no in-between and no arc: what you want to know is which of them is chosen, and what you want to do
 * is choose the next. So it is a button that says the value and cycles when clicked.
 *
 * A single cell shows the value's initial -- which is what a corner switch has room for, and how the
 * reference instrument draws its envelope's model -- and anything wider shows the whole label. Lit in
 * the module's accent, so a face reads as one thing and the switch is visibly a control rather than a
 * caption.
 */

const FONT_SIZE = 10;
/** A cell is small; the label needs the tile's own edge to breathe. */
const PADDING = 3;

export class SelectBlock implements Block {
  readonly view = new Container();
  private readonly tile = new Graphics();
  private readonly label: Text;
  private style: BlockStyle;
  private index = 0;

  constructor(
    readonly geometry: SelectGeometry,
    style: BlockStyle,
  ) {
    this.style = style;
    this.view.position.set(geometry.x, geometry.y);
    this.label = new Text({
      text: "",
      style: { fontSize: FONT_SIZE, fill: style.tile.fill, fontWeight: "600" },
    });
    this.label.anchor.set(0.5);
    this.label.position.set(geometry.width / 2, geometry.height / 2);
    this.view.addChild(this.tile, this.label);
    this.index = Math.round(geometry.param.default);
    this.draw();
  }

  /** The value the document holds, as the number a param carries. */
  setValue(value: number): void {
    const next = Math.round(value);
    if (next === this.index) return;
    this.index = next;
    this.draw();
  }

  /** Which value is showing, and the label it is showing. What a script asks for. */
  get value(): number {
    return this.index;
  }
  get text(): string {
    return this.label.text;
  }

  private draw(): void {
    // The switch is lit rather than outlined: it is the one block whose whole point is that it is
    // set to something, and an unlit tile among lit knobs reads as a label.
    drawTile(this.tile, this.geometry, {
      fill: this.style.accent,
      stroke: this.style.tile.stroke,
    });
    const labels = this.geometry.param.enumLabels ?? [];
    const full = labels[this.index] ?? String(this.index);
    // One cell is room for a letter. Anything wider gets the name, trimmed if it still does not fit.
    this.label.text = this.geometry.cols < 2 ? (full[0] ?? "") : full;
    this.label.style.fill = this.style.tile.fill;
    fitText(this.label, this.geometry.width - PADDING * 2);
  }

  setStyle(style: BlockStyle): void {
    this.style = style;
    this.draw();
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}

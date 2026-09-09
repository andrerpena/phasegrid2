import { Container, Graphics, Text } from "pixi.js";
import { HEADER_HEIGHT } from "../../layout";
import type { Block, BlockStyle } from "./Block";

/**
 * The title row: the module's name in its accent, over a hairline that separates it from the face.
 *
 * Every module has one, above whatever face it declared; it is the one row the face language does
 * not describe, because a module with no name is not a thing a patch can be read from. The hairline
 * matters once a node has four knobs and the title stops being the only text on it.
 */
export class TitleBlock implements Block {
  readonly view = new Container();
  private readonly text: Text;
  private readonly rule = new Graphics();

  constructor(
    label: string,
    private readonly width: number,
    style: BlockStyle,
  ) {
    this.text = new Text({
      text: label,
      style: {
        fontSize: 11,
        fill: style.accent,
        fontFamily: "system-ui, sans-serif",
      },
    });
    this.text.anchor.set(0.5, 0);
    this.text.position.set(width / 2, 4);
    this.view.addChild(this.rule, this.text);
    this.drawRule(style);
  }

  private drawRule(style: BlockStyle): void {
    this.rule
      .clear()
      .moveTo(1, HEADER_HEIGHT - 6)
      .lineTo(this.width - 1, HEADER_HEIGHT - 6)
      .stroke({ width: 1, color: style.tile.stroke, alpha: 0.8 });
  }

  setStyle(style: BlockStyle): void {
    this.text.style.fill = style.accent;
    this.drawRule(style);
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}

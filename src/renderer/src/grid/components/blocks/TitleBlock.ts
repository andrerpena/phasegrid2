import { Container, Graphics, Text } from "pixi.js";
import type { TitleBlock as TitleGeometry } from "../../face";
import { type Block, type BlockStyle, drawTile, fitText } from "./Block";

/** The name's inset from the tile's left edge. */
export const TITLE_PADDING = 6;

/**
 * The title: one row across the module with its name at the left in the module's accent, on a tile
 * like every other block, so the name is a key on the panel and not a bar over it.
 *
 * Every module has one, above whatever face it declared; it is the one block the face language does
 * not describe, because a module with no name is not a thing a patch can be read from. The label is
 * the document's (a module can be renamed) rather than the face's, so it is handed in beside the
 * geometry.
 */
export class TitleBlock implements Block {
  readonly view = new Container();
  private readonly tile = new Graphics();
  private readonly text: Text;

  constructor(
    readonly geometry: TitleGeometry,
    label: string,
    style: BlockStyle,
  ) {
    this.view.position.set(geometry.x, geometry.y);
    this.text = new Text({
      text: label,
      style: {
        fontSize: 11,
        fill: style.accent,
        fontFamily: "system-ui, sans-serif",
      },
    });
    // Left, like a label on a panel, and trimmed to the tile when a narrow module has a long name.
    this.text.anchor.set(0, 0.5);
    this.text.position.set(TITLE_PADDING, geometry.height / 2);
    fitText(this.text, geometry.width - 2 * TITLE_PADDING);
    this.view.addChild(this.tile, this.text);
    drawTile(this.tile, geometry, style.tile);
  }

  setStyle(style: BlockStyle): void {
    this.text.style.fill = style.accent;
    drawTile(this.tile, this.geometry, style.tile);
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}

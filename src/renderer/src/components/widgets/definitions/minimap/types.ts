import type { PatchBounds } from "@renderer/grid/patch-bounds";
import type { GridColors } from "@renderer/theming/theme";
import type { ModuleDescriptor } from "@shared/protocol/catalog";
import type { PatchDoc } from "@shared/protocol/patch";

/**
 * What a drawer writes into.
 *
 * Structural rather than `ImageData`, which a drawer does not need and which does not exist outside
 * a browser -- so this is also what lets the drawers be tested without a DOM. A real `ImageData`
 * satisfies it, and the widget passes one so the result can be blitted straight to a canvas.
 */
export interface MinimapBuffer {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/**
 * What a minimap drawer is handed.
 *
 * `paint` takes patch-cell coordinates, not buffer pixels — the origin offset is applied here, so a
 * drawer never has to know that the buffer is a window onto an unbounded plane. That is the whole
 * point of the seam: a drawer says "this cell is this colour" in the coordinates it already thinks
 * in.
 */
export interface MinimapPaintContext {
  /** One cell, in patch-cell coordinates. Out of bounds is silently dropped. */
  paint(x: number, y: number, r: number, g: number, b: number): void;
  doc: PatchDoc;
  catalog: Map<string, ModuleDescriptor>;
  colors: GridColors;
  bounds: PatchBounds;
}

export interface MinimapDrawer {
  id: string;
  /**
   * "static" runs only when what it watches changes; "dynamic" runs every frame.
   *
   * The distinction is what keeps the minimap cheap. A patch's modules and cables change when you
   * edit; a playhead changes sixty times a second. Repainting the first at the second's rate is most
   * of the cost of a naive minimap.
   */
  layer: "static" | "dynamic";
  /**
   * What a static drawer watches. Compared by identity between frames; when it changes, the drawer
   * runs again. Required for "static", ignored for "dynamic".
   */
  staticKey?(doc: PatchDoc): unknown;
  draw(context: MinimapPaintContext): void;
}

/**
 * Writes one pixel, given the buffer and the bounds.
 *
 * A drawer never calls this: the widget binds it into `paint` above. It is exported for the drawers'
 * own tests, which want to assert on a buffer without building a widget.
 */
export function setCell(
  buffer: MinimapBuffer,
  bounds: PatchBounds,
  cellX: number,
  cellY: number,
  r: number,
  g: number,
  b: number,
): void {
  const x = cellX - bounds.originX;
  const y = cellY - bounds.originY;
  if (x < 0 || y < 0 || x >= buffer.width || y >= buffer.height) return;
  const at = (y * buffer.width + x) * 4;
  buffer.data[at] = r;
  buffer.data[at + 1] = g;
  buffer.data[at + 2] = b;
  buffer.data[at + 3] = 255;
}

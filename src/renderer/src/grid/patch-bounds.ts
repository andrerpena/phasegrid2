import type { ModuleDescriptor } from "@shared/protocol/catalog";
import type { PatchDoc } from "@shared/protocol/patch";
import { CELL, measureNode } from "./layout";

/**
 * The rectangle a patch occupies, in grid cells.
 *
 * OSMC's minimap paints into a buffer the size of the world, because its world is a bounded grid: a
 * cell is a pixel and the buffer never changes shape. A patch has no bounds — modules sit at
 * arbitrary coordinates on an unbounded plane — so the buffer is sized from the patch itself and
 * reallocated when the patch grows past it.
 *
 * Cells rather than patch units, because one pixel per cell is the resolution that makes a module
 * read as a block rather than a dot, and because it is what keeps the buffer small: a patch spanning
 * ten thousand units is four hundred pixels across.
 *
 * Padded, so a module at the edge is not flush against the border and there is somewhere for the
 * viewport rectangle to sit when you have scrolled past the last module.
 */

export const PADDING_CELLS = 4;
/** An empty patch still needs a buffer; this is what it gets. */
export const EMPTY_SIZE = 16;

export interface PatchBounds {
  /** Patch-cell coordinate of buffer pixel (0, 0). */
  originX: number;
  originY: number;
  width: number;
  height: number;
}

/** The same rectangle in patch units, which is what the viewport works in. */
export function patchRect(
  doc: PatchDoc,
  catalog: Map<string, ModuleDescriptor>,
): { x: number; y: number; width: number; height: number } {
  const bounds = patchBounds(doc, catalog);
  return {
    x: bounds.originX * CELL,
    y: bounds.originY * CELL,
    width: bounds.width * CELL,
    height: bounds.height * CELL,
  };
}

export function patchBounds(
  doc: PatchDoc,
  catalog: Map<string, ModuleDescriptor>,
): PatchBounds {
  if (doc.modules.length === 0)
    return {
      originX: 0,
      originY: 0,
      width: EMPTY_SIZE,
      height: EMPTY_SIZE,
    };

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const module of doc.modules) {
    const descriptor = catalog.get(module.type);
    // A type the catalogue does not know still occupies space, or the bounds would exclude a module
    // that is plainly on screen. One cell is the smallest honest guess.
    const size =
      descriptor === undefined
        ? { width: CELL, height: CELL }
        : measureNode(descriptor);
    // Position is optional in the document; the renderer draws such a module at the origin, so the
    // bounds must agree or the minimap would leave it out.
    const x = module.x ?? 0;
    const y = module.y ?? 0;
    const left = Math.floor(x / CELL);
    const top = Math.floor(y / CELL);
    // Ceiling on the far edge: a module ending mid-cell still colours that cell.
    const right = Math.ceil((x + size.width) / CELL);
    const bottom = Math.ceil((y + size.height) / CELL);
    if (left < minX) minX = left;
    if (top < minY) minY = top;
    if (right > maxX) maxX = right;
    if (bottom > maxY) maxY = bottom;
  }

  return {
    originX: minX - PADDING_CELLS,
    originY: minY - PADDING_CELLS,
    width: Math.max(1, maxX - minX + PADDING_CELLS * 2),
    height: Math.max(1, maxY - minY + PADDING_CELLS * 2),
  };
}

/** Whether a buffer sized for `a` can still hold `b`, so it is only reallocated when it must be. */
export function sameShape(a: PatchBounds | null, b: PatchBounds): boolean {
  return (
    a !== null &&
    a.originX === b.originX &&
    a.originY === b.originY &&
    a.width === b.width &&
    a.height === b.height
  );
}

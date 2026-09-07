import { CELL } from "@renderer/grid/layout";
import type { ModuleDescriptor } from "@shared/protocol/catalog";
import type { PatchDoc, PatchOp } from "@shared/protocol/patch";

/**
 * Putting a new module into a patch: choosing its name and where it goes.
 *
 * Both are small decisions that are irritating when they are wrong. An id that collides silently
 * replaces an existing module, and a position that lands under an existing one makes the new module
 * look like it failed to appear.
 */

/**
 * A readable, unique id derived from the type.
 *
 * `osc.wavetable` becomes `wavetable`, then `wavetable2` and so on. The type's own prefix is dropped
 * because a patch full of `osc.wavetable1`, `osc.wavetable2` reads worse than the same thing without
 * it, and the type is still on the node's face.
 */
export function uniqueModuleId(doc: PatchDoc, type: string): string {
  const base = (type.split(".").pop() ?? type).replace(/[^a-zA-Z0-9]/g, "");
  const taken = new Set(doc.modules.map((m) => m.id));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Somewhere free near a preferred point, on the grid.
 *
 * Walks right, then down, in whole cells until it finds a spot nothing overlaps. Simple rather than
 * clever: what matters is that a new module is visible and not on top of another one.
 */
/** How wide a row of newly added modules gets before it wraps, in patch units. */
export const ROW_WIDTH = CELL * 46;

export function freePosition(
  doc: PatchDoc,
  sizeOf: (type: string) => { width: number; height: number },
  preferred: { x: number; y: number },
  /** The size of the module being placed. Assuming a fixed one overlaps every module wider than it. */
  size: { width: number; height: number } = {
    width: CELL * 6,
    height: CELL * 4,
  },
): { x: number; y: number } {
  const occupied = doc.modules.map((m) => ({
    x: m.x ?? 0,
    y: m.y ?? 0,
    ...sizeOf(m.type),
  }));
  const overlaps = (x: number, y: number) =>
    occupied.some(
      (o) =>
        x < o.x + o.width &&
        x + size.width > o.x &&
        y < o.y + o.height &&
        y + size.height > o.y,
    );

  const startX = Math.round(preferred.x / CELL) * CELL;
  const startY = Math.round(preferred.y / CELL) * CELL;
  // Stepping by the module's own size plus a cell of air, so a row of modules reads as a row rather
  // than as a pile. Stepping by a fixed amount puts wide modules on top of each other.
  const stepX = size.width + CELL;
  const stepY = size.height + CELL;
  // Wrapping to a new row rather than queueing rightward forever. Without this, adding a dozen modules
  // puts most of them past the edge of the window, where they exist but nobody can see them.
  const perRow = Math.max(1, Math.floor(ROW_WIDTH / stepX));
  for (let row = 0; row < 40; row++) {
    for (let col = 0; col < perRow; col++) {
      const x = startX + col * stepX;
      const y = startY + row * stepY;
      if (!overlaps(x, y)) return { x, y };
    }
  }
  // Every candidate was taken, which takes a very large patch. Placing it at the preferred point
  // beats refusing to add the module at all.
  return { x: startX, y: startY };
}

/** The operation that adds a module, with its id and position already decided. */
export function addModuleOp(
  doc: PatchDoc,
  descriptor: ModuleDescriptor,
  sizeOf: (type: string) => { width: number; height: number },
  preferred: { x: number; y: number },
): PatchOp {
  const { x, y } = freePosition(doc, sizeOf, preferred, sizeOf(descriptor.id));
  return {
    op: "moduleAdd",
    id: uniqueModuleId(doc, descriptor.id),
    type: descriptor.id,
    x,
    y,
  };
}

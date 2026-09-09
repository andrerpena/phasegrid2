import { composeFace } from "@renderer/grid/face";
import { CELL } from "@renderer/grid/layout";
import { hexToRgb } from "@renderer/lib/color";
import type { ModuleDescriptor } from "@shared/protocol/catalog";
import type { PatchDoc, PortRef } from "@shared/protocol/patch";
import type { MinimapDrawer } from "./types";

/**
 * Every cable, as a line between the modules it joins.
 *
 * Straight rather than curved. On the canvas a cable is a bezier because it has to be readable
 * where several converge; at one pixel per cell the curve is a rounding error and the straight line
 * is the same three pixels.
 *
 * Drawn under the modules — registered first — so a cable disappearing behind a module reads as
 * plugged in rather than as crossing over it.
 */

/** The centre of a module, in patch-cell coordinates. */
function centreOf(
  doc: PatchDoc,
  catalog: Map<string, ModuleDescriptor>,
  ref: PortRef,
): { x: number; y: number } | null {
  const module = doc.modules.find((m) => m.id === ref.module);
  if (module === undefined) return null;
  const descriptor = catalog.get(module.type);
  const size =
    descriptor === undefined
      ? { width: CELL, height: CELL }
      : composeFace(descriptor);
  return {
    x: ((module.x ?? 0) + size.width / 2) / CELL,
    y: ((module.y ?? 0) + size.height / 2) / CELL,
  };
}

/** Bresenham. A cable is a handful of cells; anything cleverer would be slower to read. */
function line(
  from: { x: number; y: number },
  to: { x: number; y: number },
  plot: (x: number, y: number) => void,
): void {
  let x = Math.round(from.x);
  let y = Math.round(from.y);
  const endX = Math.round(to.x);
  const endY = Math.round(to.y);
  const stepX = x < endX ? 1 : -1;
  const stepY = y < endY ? 1 : -1;
  const spanX = Math.abs(endX - x);
  const spanY = Math.abs(endY - y);
  let error = spanX - spanY;

  // Bounded, because a corrupt document with a module at ten million would otherwise loop for a
  // very long time on the frame that draws it.
  for (let guard = 0; guard < 4096; guard++) {
    plot(x, y);
    if (x === endX && y === endY) return;
    const doubled = error * 2;
    if (doubled > -spanY) {
      error -= spanY;
      x += stepX;
    }
    if (doubled < spanX) {
      error += spanX;
      y += stepY;
    }
  }
}

export const cablesDrawer: MinimapDrawer = {
  id: "cables",
  layer: "static",
  staticKey: (doc) => doc.edges,
  draw({ paint, doc, catalog, colors }) {
    for (const edge of doc.edges) {
      const from = centreOf(doc, catalog, edge.from);
      const to = centreOf(doc, catalog, edge.to);
      if (from === null || to === null) continue;

      // The source's role, because that is what the cable carries.
      const source = doc.modules.find((m) => m.id === edge.from.module);
      const descriptor = catalog.get(source?.type ?? "");
      const role = descriptor?.outputs.find(
        (o) => o.id === edge.from.port,
      )?.role;
      const hex =
        role !== undefined && role in colors.signal
          ? colors.signal[role as keyof typeof colors.signal]
          : colors.signal.any;
      const { r, g, b } = hexToRgb(hex);

      line(from, to, (x, y) => paint(x, y, r, g, b));
    }
  },
};

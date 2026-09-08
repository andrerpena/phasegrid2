import { CELL, measureNode } from "@renderer/grid/layout";
import { hexToRgb } from "@renderer/lib/color";
import type { MinimapDrawer } from "./types";

/**
 * Every module, as a filled block the size of its footprint.
 *
 * Coloured by the role of its first output, so a patch reads as its signal flow rather than as a
 * field of identical grey rectangles: oscillators one colour, filters another, note sources another,
 * all from the engine's own descriptors. A module with no outputs — an audio sink — takes the node
 * fill, which is what it looks like on the canvas too.
 *
 * Static, keyed on the module list: this repaints when you add, move or remove a module and not when
 * a knob turns.
 */
export const modulesDrawer: MinimapDrawer = {
  id: "modules",
  layer: "static",
  staticKey: (doc) => doc.modules,
  draw({ paint, doc, catalog, colors }) {
    for (const module of doc.modules) {
      const descriptor = catalog.get(module.type);
      const size =
        descriptor === undefined
          ? { width: CELL, height: CELL }
          : measureNode(descriptor);
      const role = descriptor?.outputs?.[0]?.role;
      const hex =
        role !== undefined && role in colors.signal
          ? colors.signal[role as keyof typeof colors.signal]
          : colors.nodeFill;
      const { r, g, b } = hexToRgb(hex);

      const x = module.x ?? 0;
      const y = module.y ?? 0;
      const left = Math.floor(x / CELL);
      const top = Math.floor(y / CELL);
      const right = Math.ceil((x + size.width) / CELL);
      const bottom = Math.ceil((y + size.height) / CELL);
      for (let cy = top; cy < bottom; cy++)
        for (let cx = left; cx < right; cx++) paint(cx, cy, r, g, b);
    }
  },
};

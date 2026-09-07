import { CELL } from "@renderer/grid/layout";
import { EMPTY_PATCH, type PatchDoc } from "@shared/protocol/patch";
import { describe, expect, it } from "vitest";
import { freePosition, ROW_WIDTH, uniqueModuleId } from "./add-module";

const size = () => ({ width: CELL * 6, height: CELL * 4 });

const doc: PatchDoc = {
  ...EMPTY_PATCH,
  modules: [
    { id: "wavetable", type: "osc.wavetable", x: 0, y: 0 },
    { id: "vca", type: "amp.vca", x: 240, y: 0 },
  ],
};

describe("naming a new module", () => {
  it("drops the type's prefix, because the type is already on the node", () => {
    expect(uniqueModuleId(EMPTY_PATCH, "osc.wavetable")).toBe("wavetable");
  });

  it("numbers a name that is taken", () => {
    // A colliding id silently replaces the module that had it, which looks like the new one failed
    // to appear and the old one changed by itself.
    expect(uniqueModuleId(doc, "osc.wavetable")).toBe("wavetable2");
  });

  it("keeps counting past the second", () => {
    const two: PatchDoc = {
      ...doc,
      modules: [...doc.modules, { id: "wavetable2", type: "osc.wavetable" }],
    };
    expect(uniqueModuleId(two, "osc.wavetable")).toBe("wavetable3");
  });
});

describe("placing a new module", () => {
  it("uses the preferred spot when it is free", () => {
    expect(freePosition(EMPTY_PATCH, size, { x: 120, y: 96 })).toEqual({
      x: 120,
      y: 96,
    });
  });

  it("snaps the preferred spot to the grid", () => {
    const at = freePosition(EMPTY_PATCH, size, { x: 130, y: 100 });
    expect(at.x % CELL).toBe(0);
    expect(at.y % CELL).toBe(0);
  });

  it("moves aside rather than landing on an existing module", () => {
    // A module hidden under another looks like it was never added, and the next thing a person does
    // is add it again.
    const at = freePosition(doc, size, { x: 0, y: 0 });
    expect(at).not.toEqual({ x: 0, y: 0 });
    expect(at.x % CELL).toBe(0);
  });

  it("finds a spot even in a crowded row", () => {
    const crowded: PatchDoc = {
      ...EMPTY_PATCH,
      modules: Array.from({ length: 12 }, (_, i) => ({
        id: `m${i}`,
        type: "amp.vca",
        x: i * CELL * 2,
        y: 0,
      })),
    };
    const at = freePosition(crowded, size, { x: 0, y: 0 });
    const clashes = crowded.modules.some(
      (m) =>
        at.x < (m.x ?? 0) + CELL * 6 &&
        at.x + CELL * 6 > (m.x ?? 0) &&
        at.y < (m.y ?? 0) + CELL * 4 &&
        at.y + CELL * 4 > (m.y ?? 0),
    );
    expect(clashes).toBe(false);
  });
});

describe("placing modules of different widths", () => {
  it("does not put a wide module on top of a narrow one", () => {
    // Placement used to assume every module was the same size, so anything wider than the assumption
    // landed across its neighbour and the patch looked like a pile.
    const widths: Record<string, number> = {
      "amp.vca": CELL * 3,
      "osc.wavetable": CELL * 10,
    };
    const sizeOf = (type: string) => ({
      width: widths[type] ?? CELL * 4,
      height: CELL * 4,
    });
    let doc: PatchDoc = { ...EMPTY_PATCH, modules: [] };

    for (const type of ["osc.wavetable", "osc.wavetable", "amp.vca"]) {
      const at = freePosition(doc, sizeOf, { x: 48, y: 48 }, sizeOf(type));
      doc = {
        ...doc,
        modules: [
          ...doc.modules,
          { id: `m${doc.modules.length}`, type, x: at.x, y: at.y },
        ],
      };
    }

    for (let i = 0; i < doc.modules.length; i++) {
      for (let j = i + 1; j < doc.modules.length; j++) {
        const a = doc.modules[i];
        const b = doc.modules[j];
        const sa = sizeOf(a.type);
        const sb = sizeOf(b.type);
        const overlap =
          (a.x ?? 0) < (b.x ?? 0) + sb.width &&
          (a.x ?? 0) + sa.width > (b.x ?? 0) &&
          (a.y ?? 0) < (b.y ?? 0) + sb.height &&
          (a.y ?? 0) + sa.height > (b.y ?? 0);
        expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
  });
});

describe("adding many modules", () => {
  it("wraps to a new row instead of queueing off the edge of the window", () => {
    // Queueing rightward forever puts most of a dozen modules where they exist but nobody can see
    // them, which reads as the interface having ignored the clicks.
    const sizeOf = () => ({ width: CELL * 8, height: CELL * 4 });
    let doc: PatchDoc = { ...EMPTY_PATCH, modules: [] };
    for (let i = 0; i < 12; i++) {
      const at = freePosition(doc, sizeOf, { x: 48, y: 48 }, sizeOf());
      doc = {
        ...doc,
        modules: [
          ...doc.modules,
          { id: `m${i}`, type: "amp.vca", x: at.x, y: at.y },
        ],
      };
    }
    const rows = new Set(doc.modules.map((m) => m.y));
    expect(rows.size).toBeGreaterThan(1);
    expect(Math.max(...doc.modules.map((m) => m.x ?? 0))).toBeLessThan(
      ROW_WIDTH + 200,
    );
  });
});

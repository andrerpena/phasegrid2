import type { ModuleDescriptor } from "@shared/protocol/catalog";
import {
  EMPTY_PATCH,
  type PatchDoc,
  type PatchModule,
} from "@shared/protocol/patch";
import { describe, expect, it } from "vitest";
import { DESCRIPTORS, moduleNode } from "./fixtures";
import { CELL, measureNode } from "./layout";
import {
  EMPTY_SIZE,
  PADDING_CELLS,
  patchBounds,
  sameShape,
} from "./patch-bounds";

/**
 * The engine's own descriptors, so a footprint here is the footprint the canvas draws. Inventing
 * descriptors would prove only that the bounds agree with the invention.
 */
const catalog: Map<string, ModuleDescriptor> = DESCRIPTORS;
const VCA = "amp.vca";
const vcaCells = Math.ceil(
  measureNode(catalog.get(VCA) as ModuleDescriptor).width / CELL,
);

function patchWith(modules: PatchModule[]): PatchDoc {
  return { ...EMPTY_PATCH, modules };
}

describe("the rectangle a patch occupies", () => {
  it("gives an empty patch a buffer anyway", () => {
    const bounds = patchBounds(EMPTY_PATCH, catalog);
    expect(bounds.width).toBe(EMPTY_SIZE);
    expect(bounds.height).toBe(EMPTY_SIZE);
  });

  it("pads around a single module, so it is not flush against the edge", () => {
    const bounds = patchBounds(
      patchWith([moduleNode("m1", VCA, { x: 0, y: 0 })]),
      catalog,
    );
    expect(bounds.originX).toBe(-PADDING_CELLS);
    expect(bounds.originY).toBe(-PADDING_CELLS);
    expect(bounds.width).toBe(vcaCells + PADDING_CELLS * 2);
  });

  it("spans every module, wherever they are", () => {
    const bounds = patchBounds(
      patchWith([
        moduleNode("m1", VCA, { x: 0, y: 0 }),
        moduleNode("m2", VCA, { x: CELL * 40, y: CELL * 20 }),
      ]),
      catalog,
    );
    expect(bounds.originX).toBe(-PADDING_CELLS);
    expect(bounds.width).toBe(40 + vcaCells + PADDING_CELLS * 2);
    expect(bounds.height).toBeGreaterThan(20);
  });

  it("handles negative positions, because the plane has no origin to speak of", () => {
    const bounds = patchBounds(
      patchWith([moduleNode("m1", VCA, { x: -CELL * 10, y: -CELL * 6 })]),
      catalog,
    );
    expect(bounds.originX).toBe(-10 - PADDING_CELLS);
    expect(bounds.originY).toBe(-6 - PADDING_CELLS);
  });

  it("still counts a module whose type it has never heard of", () => {
    // Otherwise a patch from a build with one more module in it would have a hole in its map where
    // something is plainly drawn.
    const bounds = patchBounds(
      patchWith([moduleNode("m1", "nonesuch", { x: CELL * 50, y: 0 })]),
      catalog,
    );
    expect(bounds.originX).toBe(50 - PADDING_CELLS);
  });

  it("treats a module with no position as being at the origin, like the renderer does", () => {
    const bounds = patchBounds(patchWith([{ id: "m1", type: VCA }]), catalog);
    expect(bounds.originX).toBe(-PADDING_CELLS);
    expect(bounds.originY).toBe(-PADDING_CELLS);
  });
});

describe("deciding whether to reallocate", () => {
  const doc = patchWith([moduleNode("m1", VCA, { x: 0, y: 0 })]);

  it("keeps the buffer when nothing about the extent changed", () => {
    expect(
      sameShape(patchBounds(doc, catalog), patchBounds(doc, catalog)),
    ).toBe(true);
  });

  it("keeps the buffer when a module moves inside the bounds", () => {
    // The common case while editing, and the reason the check is on shape rather than on the doc.
    const wide = patchWith([
      moduleNode("m1", VCA, { x: 0, y: 0 }),
      moduleNode("m2", VCA, { x: CELL * 40, y: CELL * 40 }),
    ]);
    const nudged = patchWith([
      moduleNode("m1", VCA, { x: CELL * 5, y: CELL * 5 }),
      moduleNode("m2", VCA, { x: CELL * 40, y: CELL * 40 }),
    ]);
    expect(
      sameShape(patchBounds(wide, catalog), patchBounds(nudged, catalog)),
    ).toBe(false);
    // ...but the origin only moves because m1 defined it. Two interior modules do not.
    const interior = patchWith([
      moduleNode("m1", VCA, { x: 0, y: 0 }),
      moduleNode("m2", VCA, { x: CELL * 40, y: CELL * 40 }),
      moduleNode("m3", VCA, { x: CELL * 10, y: CELL * 10 }),
    ]);
    const interiorMoved = patchWith([
      moduleNode("m1", VCA, { x: 0, y: 0 }),
      moduleNode("m2", VCA, { x: CELL * 40, y: CELL * 40 }),
      moduleNode("m3", VCA, { x: CELL * 12, y: CELL * 12 }),
    ]);
    expect(
      sameShape(
        patchBounds(interior, catalog),
        patchBounds(interiorMoved, catalog),
      ),
    ).toBe(true);
  });

  it("reallocates when the patch grows", () => {
    const grown = patchWith([
      moduleNode("m1", VCA, { x: 0, y: 0 }),
      moduleNode("m2", VCA, { x: CELL * 30, y: 0 }),
    ]);
    expect(
      sameShape(patchBounds(doc, catalog), patchBounds(grown, catalog)),
    ).toBe(false);
  });

  it("has nothing to compare against on the first frame", () => {
    expect(sameShape(null, patchBounds(doc, catalog))).toBe(false);
  });
});

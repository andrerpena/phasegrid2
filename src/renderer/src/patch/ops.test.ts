import {
  EMPTY_PATCH,
  type PatchDoc,
  type PatchOp,
} from "@shared/protocol/patch";
import { describe, expect, it } from "vitest";
import { applyOps, invert } from "./ops";

const base: PatchDoc = {
  ...EMPTY_PATCH,
  modules: [
    { id: "osc", type: "osc.wavetable", x: 0, y: 0, params: { level: 0.5 } },
    { id: "out", type: "io.audioOut", x: 200, y: 0 },
  ],
  edges: [
    {
      id: "e1",
      from: { module: "osc", port: "out" },
      to: { module: "out", port: "inL" },
    },
  ],
};

/**
 * Deep equality that does not care what order an object's keys were written in.
 *
 * A rebuilt module has its keys in the order `applyOp` writes them, which need not match the order a
 * hand-written fixture used. That difference is invisible to everything that reads the document, so a
 * plain string comparison would fail on a round trip that is in fact exact.
 */
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, normalize(v)]),
    );
  return value;
}

/** The property that matters: undoing an edit returns the document it started from. */
function roundTrips(doc: PatchDoc, ops: PatchOp[]): boolean {
  const after = applyOps(doc, ops);
  const back = applyOps(after, invert(doc, ops));
  return JSON.stringify(normalize(back)) === JSON.stringify(normalize(doc));
}

describe("applying operations", () => {
  it("adds a module", () => {
    const after = applyOps(base, [
      { op: "moduleAdd", id: "flt", type: "filter.multi" },
    ]);
    expect(after.modules.map((m) => m.id)).toContain("flt");
  });

  it("removes the edges that reached a removed module", () => {
    // Leaving them would produce a document that cannot compile, and the engine would reject the whole
    // batch rather than the one edge that no longer has an end.
    const after = applyOps(base, [{ op: "moduleRemove", id: "osc" }]);
    expect(after.edges).toHaveLength(0);
  });

  it("sets a param without disturbing the others", () => {
    const after = applyOps(base, [
      { op: "paramSet", module: "osc", param: "detune", value: 0.2 },
    ]);
    expect(after.modules[0].params).toEqual({ level: 0.5, detune: 0.2 });
  });

  it("moves a module", () => {
    const after = applyOps(base, [
      { op: "moduleMove", id: "osc", x: 50, y: 60 },
    ]);
    expect(after.modules[0]).toMatchObject({ x: 50, y: 60 });
  });

  it("leaves the original document untouched", () => {
    const before = JSON.stringify(base);
    applyOps(base, [{ op: "moduleRemove", id: "osc" }]);
    expect(JSON.stringify(base)).toBe(before);
  });
});

describe("inverting operations", () => {
  it("undoes an added module", () => {
    expect(
      roundTrips(base, [{ op: "moduleAdd", id: "flt", type: "filter.multi" }]),
    ).toBe(true);
  });

  it("undoes a removed module together with its edges", () => {
    // One operation whose inverse is several. Getting this wrong loses the connections silently, and
    // the patch still looks plausible afterwards, which is the worst kind of wrong.
    expect(roundTrips(base, [{ op: "moduleRemove", id: "osc" }])).toBe(true);
  });

  it("undoes a param change back to its previous value", () => {
    expect(
      roundTrips(base, [
        { op: "paramSet", module: "osc", param: "level", value: 0.9 },
      ]),
    ).toBe(true);
  });

  it("undoes a move back to where it was", () => {
    expect(
      roundTrips(base, [{ op: "moduleMove", id: "osc", x: 99, y: 99 }]),
    ).toBe(true);
  });

  it("undoes a voice count change", () => {
    expect(roundTrips(base, [{ op: "setVoiceCount", voiceCount: 8 }])).toBe(
      true,
    );
  });

  it("undoes several operations in the right order", () => {
    // Reversed, because undoing a sequence means undoing its last step first. Applied forwards, the
    // second operation's inverse would run against a document that no longer matches it.
    expect(
      roundTrips(base, [
        { op: "moduleAdd", id: "flt", type: "filter.multi" },
        {
          op: "edgeAdd",
          id: "e2",
          from: { module: "osc", port: "out" },
          to: { module: "flt", port: "in" },
        },
        { op: "moduleRemove", id: "out" },
      ]),
    ).toBe(true);
  });

  it("undoes two operations touching the same thing", () => {
    // Each inverse is computed against the document as it stood at that step. Computing them all
    // against the starting document would restore the first value twice and lose the intermediate.
    expect(
      roundTrips(base, [
        { op: "paramSet", module: "osc", param: "level", value: 0.7 },
        { op: "paramSet", module: "osc", param: "level", value: 0.9 },
      ]),
    ).toBe(true);
  });

  it("treats adding over an existing id as a replacement", () => {
    expect(
      roundTrips(base, [
        {
          op: "moduleAdd",
          id: "osc",
          type: "osc.wavetable",
          params: { level: 1 },
        },
      ]),
    ).toBe(true);
  });

  it("has nothing to undo for a param that had no explicit value", () => {
    // There is no previous number to restore, and the descriptor default is a different thing. An
    // honest gap rather than a wrong inverse.
    const ops: PatchOp[] = [
      { op: "paramSet", module: "out", param: "gain", value: 0.3 },
    ];
    expect(invert(base, ops)).toEqual([]);
  });

  it("has nothing to undo for removing something that was not there", () => {
    expect(invert(base, [{ op: "moduleRemove", id: "ghost" }])).toEqual([]);
    expect(invert(base, [{ op: "edgeRemove", id: "ghost" }])).toEqual([]);
  });
});

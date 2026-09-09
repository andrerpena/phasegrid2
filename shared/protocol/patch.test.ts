import { describe, expect, it } from "vitest";
import {
  engineOps,
  isEngineOp,
  PatchDocSchema,
  type PatchOp,
  PatchOpSchema,
  UI_ONLY_OPS,
} from "./patch";

/** One of every op, which is also the list the round-trip and the exhaustiveness checks walk. */
const oneOfEach: PatchOp[] = [
  {
    op: "moduleAdd",
    id: "osc1",
    type: "osc.wavetable",
    x: 10,
    y: 20,
    params: { level: 0.5 },
    data: { table: "saw" },
  },
  { op: "moduleRemove", id: "osc1" },
  { op: "moduleSetData", id: "pat1", data: { pattern: "c e g" } },
  {
    op: "edgeAdd",
    id: "e1",
    from: { module: "osc1", port: "out" },
    to: { module: "out1", port: "in" },
  },
  { op: "edgeRemove", id: "e1" },
  { op: "paramSet", module: "osc1", param: "level", value: 0.25 },
  { op: "moduleMove", id: "osc1", x: 4, y: 8 },
  { op: "setVoiceCount", voiceCount: 8 },
];

describe("PatchOp", () => {
  it("round-trips every op through parse unchanged", () => {
    for (const op of oneOfEach) {
      expect(PatchOpSchema.parse(JSON.parse(JSON.stringify(op)))).toEqual(op);
    }
  });

  it("covers every op kind the union declares", () => {
    expect(new Set(oneOfEach.map((o) => o.op)).size).toBe(oneOfEach.length);
    expect(PatchOpSchema.options).toHaveLength(oneOfEach.length);
  });

  it("rejects an unknown op and a wrong-typed field", () => {
    expect(
      PatchOpSchema.safeParse({ op: "moduleRename", id: "a" }).success,
    ).toBe(false);
    expect(
      PatchOpSchema.safeParse({
        op: "paramSet",
        module: "osc1",
        param: "level",
        value: "loud",
      }).success,
    ).toBe(false);
    // An edge needs both ends, and each end needs both halves.
    expect(
      PatchOpSchema.safeParse({
        op: "edgeAdd",
        id: "e1",
        from: { module: "osc1" },
        to: { module: "out1", port: "in" },
      }).success,
    ).toBe(false);
    // Params are numbers everywhere; a string belongs in `data`.
    expect(
      PatchOpSchema.safeParse({
        op: "moduleAdd",
        id: "a",
        type: "t",
        params: { shape: "saw" },
      }).success,
    ).toBe(false);
    expect(
      PatchOpSchema.safeParse({ op: "setVoiceCount", voiceCount: 0 }).success,
    ).toBe(false);
    expect(
      PatchOpSchema.safeParse({ op: "setVoiceCount", voiceCount: 65 }).success,
    ).toBe(false);
  });

  it("marks moduleMove, and only moduleMove, as user-interface only", () => {
    expect(UI_ONLY_OPS).toEqual(["moduleMove"]);
    for (const op of oneOfEach) {
      expect(isEngineOp(op)).toBe(op.op !== "moduleMove");
    }
    expect(engineOps(oneOfEach).map((o) => o.op)).not.toContain("moduleMove");
    expect(engineOps(oneOfEach)).toHaveLength(oneOfEach.length - 1);
  });

  it("keeps the order of the ops it forwards", () => {
    const ops: PatchOp[] = [
      { op: "moduleAdd", id: "a", type: "t" },
      { op: "moduleMove", id: "a", x: 1, y: 1 },
      { op: "paramSet", module: "a", param: "p", value: 1 },
    ];
    expect(engineOps(ops).map((o) => o.op)).toEqual(["moduleAdd", "paramSet"]);
  });
});

describe("PatchDoc", () => {
  it("parses the document the engine reads and writes", () => {
    const doc = PatchDocSchema.parse({
      schemaVersion: 1,
      voiceCount: 4,
      feedbackMode: "block",
      modules: [
        { id: "osc1", type: "osc.wavetable", params: { level: 0.5 } },
        { id: "out1", type: "io.audioOut" },
      ],
      edges: [
        {
          id: "e1",
          from: { module: "osc1", port: "out" },
          to: { module: "out1", port: "in" },
        },
      ],
    });
    expect(doc.modules).toHaveLength(2);
    expect(doc.feedbackMode).toBe("block");
  });

  it("rejects a document from another schema version or with a bad feedback mode", () => {
    expect(
      PatchDocSchema.safeParse({ schemaVersion: 2, modules: [], edges: [] })
        .success,
    ).toBe(false);
    expect(
      PatchDocSchema.safeParse({
        schemaVersion: 1,
        feedbackMode: "perSample",
        modules: [],
        edges: [],
      }).success,
    ).toBe(false);
    expect(
      PatchDocSchema.safeParse({
        schemaVersion: 1,
        modules: [{ id: "a" }],
        edges: [],
      }).success,
    ).toBe(false);
  });
});

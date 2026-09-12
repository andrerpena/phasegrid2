import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type Catalog,
  CatalogSchema,
  findModule,
  implicitPortId,
  ModuleDescriptorSchema,
  ParamDescSchema,
  PortDescSchema,
  resolveFaceToken,
} from "./catalog";

/**
 * The document the engine printed, committed so this test does not need a built engine. Regenerate with
 * `./build/engine/phasegrid-engine --catalog > engine/tests/golden/catalog.json`; the engine's own
 * `test_catalog.cpp` fails if it goes stale.
 */
const goldenPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "engine",
  "tests",
  "golden",
  "catalog.json",
);
const golden: unknown = JSON.parse(readFileSync(goldenPath, "utf8"));

describe("catalog schema", () => {
  it("parses the catalog the engine prints", () => {
    const catalog: Catalog = CatalogSchema.parse(golden);
    expect(catalog.modules.length).toBeGreaterThan(10);
    expect(catalog.conventions.blockSize).toBe(128);
    expect(catalog.conventions.lanes).toEqual(["v0.L", "v0.R", "v1.L", "v1.R"]);
    expect(catalog.catalogHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("carries each port's role through, so the editor can colour a wire", () => {
    const catalog = CatalogSchema.parse(golden);
    const osc = findModule(catalog, "osc.wavetable");
    expect(osc?.inputs.find((p) => p.id === "pitch")?.role).toBe("pitch");
    expect(osc?.inputs.find((p) => p.id === "gate")?.role).toBe("gate");
    expect(osc?.outputs.find((p) => p.id === "out")?.role).toBe("audio");
    // An event port carrying notes is `note`; one carrying bare triggers stays `gate`.
    const notes = findModule(catalog, "note.toCv")?.inputs.find(
      (p) => p.id === "notes",
    );
    expect(notes?.kind).toBe("event");
    expect(notes?.role).toBe("note");
  });

  it("describes a modulatable param and its implicit port", () => {
    const catalog = CatalogSchema.parse(golden);
    const filter = findModule(catalog, "filter.multi");
    expect(filter).toBeDefined();

    const cutoff = filter?.params.find((p) => p.id === "cutoff");
    expect(cutoff?.flags.modulatable).toBe(true);
    expect(cutoff?.unit).toBe("semitones");
    expect(cutoff?.min).toBe(8);
    expect(cutoff?.max).toBe(136);

    const port = filter?.inputs.find((p) => p.id === implicitPortId("cutoff"));
    expect(port?.implicit).toBe(true);
    expect(port?.param).toBe("cutoff");
    expect(filter?.inputs.find((p) => p.id === "in")?.implicit).toBe(false);
  });

  it("marks structural and enum params", () => {
    const catalog = CatalogSchema.parse(golden);
    const table = findModule(catalog, "osc.wavetable")?.params.find(
      (p) => p.id === "table",
    );
    expect(table?.flags.structural).toBe(true);
    expect(table?.flags.modulatable).toBe(false);
    expect(table?.enumLabels?.length).toBeGreaterThan(1);
    expect(table?.uiWidget).toBe("select");
  });

  it("says which modules can draw themselves", () => {
    const catalog = CatalogSchema.parse(golden);
    expect(findModule(catalog, "osc.sawtooth")?.flags.previewsWave).toBe(true);
    expect(findModule(catalog, "osc.wavetable")?.flags.previewsWave).toBe(true);
    expect(findModule(catalog, "amp.vca")?.flags.previewsWave).toBe(false);
  });

  it("carries only names the UI can show", () => {
    // The catalog is the one place the vendored DSP's own parameter table reaches strings the UI displays.
    // The name check itself cannot live here: scripts/check-trademark.mjs scans shared/, so writing the
    // forbidden words down would trip the guard it is testing for. `engine/tests/test_catalog.cpp` does it
    // instead, on the same document. What is checked here is that every displayed string is populated at
    // all -- a module whose name or param names came out blank would be unusable in the editor.
    const catalog = CatalogSchema.parse(golden);
    for (const m of catalog.modules) {
      expect(m.name.length).toBeGreaterThan(0);
      expect(m.doc.length).toBeGreaterThan(0);
      for (const p of m.params) expect(p.name.length).toBeGreaterThan(0);
      for (const p of [...m.inputs, ...m.outputs])
        expect(p.name.length).toBeGreaterThan(0);
    }
  });
});

describe("catalog schema rejections", () => {
  const port = {
    id: "in",
    name: "In",
    kind: "continuous",
    role: "audio",
    doc: "",
    implicit: false,
  };
  const param = {
    id: "gain",
    name: "Gain",
    min: 0,
    max: 2,
    default: 1,
    unit: "ratio",
    curve: "linear",
    flags: {
      modulatable: true,
      integer: false,
      enum: false,
      hidden: false,
      noSmooth: false,
      structural: false,
      primary: false,
    },
    uiWidget: "slider",
    doc: "",
  };

  it("accepts the shapes the engine emits", () => {
    expect(PortDescSchema.parse(port).id).toBe("in");
    expect(ParamDescSchema.parse(param).id).toBe("gain");
  });

  it("rejects a role or kind it has never heard of", () => {
    expect(PortDescSchema.parse({ ...port, role: "note" }).role).toBe("note");
    expect(() => PortDescSchema.parse({ ...port, role: "trigger" })).toThrow();
    expect(() => PortDescSchema.parse({ ...port, kind: "audio" })).toThrow();
  });

  it("rejects a port whose implicit flag and param disagree", () => {
    expect(() => PortDescSchema.parse({ ...port, implicit: true })).toThrow();
    expect(() => PortDescSchema.parse({ ...port, param: "gain" })).toThrow();
  });

  it("rejects params the engine could never produce", () => {
    expect(() => ParamDescSchema.parse({ ...param, min: 3 })).toThrow();
    expect(() => ParamDescSchema.parse({ ...param, default: 9 })).toThrow();
    expect(() =>
      ParamDescSchema.parse({
        ...param,
        flags: { ...param.flags, enum: true },
      }),
    ).toThrow();
    expect(() =>
      ParamDescSchema.parse({
        ...param,
        flags: { ...param.flags, structural: true },
      }),
    ).toThrow();
  });

  it("rejects unsorted modules and unknown top-level keys", () => {
    const catalog = CatalogSchema.parse(golden);
    expect(() =>
      CatalogSchema.parse({
        ...catalog,
        modules: [...catalog.modules].reverse(),
      }),
    ).toThrow();
    expect(() => CatalogSchema.parse({ ...catalog, extra: 1 })).toThrow();
    expect(() =>
      CatalogSchema.parse({ ...catalog, catalogHash: "not-a-hash" }),
    ).toThrow();
  });
});

describe("a module's face", () => {
  it("carries the rows the engine declared, and null for a module that declared none", () => {
    const catalog = CatalogSchema.parse(golden);
    const sine = findModule(catalog, "osc.sine");
    expect(sine?.face?.[0]).toEqual([
      "reset",
      "wave",
      "wave",
      "wave",
      "fold",
      "fold",
      "out",
    ]);
    expect(findModule(catalog, "filter.multi")?.face).toBeNull();
  });

  it("resolves a token to what it names, and refuses one that names nothing or two things", () => {
    const module = {
      inputs: [
        { id: "in" },
        { id: "gain" },
        { id: "param:gain", implicit: true },
      ],
      outputs: [{ id: "out" }],
      params: [{ id: "gain" }],
    };
    expect(resolveFaceToken(module, ".")).toEqual({ kind: "empty" });
    expect(resolveFaceToken(module, "wave")).toEqual({ kind: "wave" });
    expect(resolveFaceToken(module, "in")).toEqual({ kind: "input", id: "in" });
    expect(resolveFaceToken(module, "out")).toEqual({
      kind: "output",
      id: "out",
    });
    // `gain` is both a port and a param: the token has to say which.
    expect(resolveFaceToken(module, "gain")).toBeNull();
    expect(resolveFaceToken(module, "in:gain")).toEqual({
      kind: "input",
      id: "gain",
    });
    expect(resolveFaceToken(module, "param:gain")).toEqual({
      kind: "param",
      id: "gain",
    });
    expect(resolveFaceToken(module, "nope")).toBeNull();
    // An implicit modulation port is not a thing a face places: it rides on its knob.
    expect(resolveFaceToken(module, "in:param:gain")).toBeNull();
  });

  it("rejects a face naming something the module does not have", () => {
    const catalog = CatalogSchema.parse(golden);
    const sine = findModule(catalog, "osc.sine");
    expect(sine).toBeDefined();
    if (sine === undefined) return;
    const bad = { ...sine, face: [["reset", "nope"]] };
    expect(ModuleDescriptorSchema.safeParse(bad).success).toBe(false);
    const ragged = { ...sine, face: [["reset", "out"], ["phase"]] };
    expect(ModuleDescriptorSchema.safeParse(ragged).success).toBe(false);
  });
});

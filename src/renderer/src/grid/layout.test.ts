import type { ModuleDescriptor } from "@shared/protocol/catalog";
import { describe, expect, it } from "vitest";
import {
  faceParams,
  intersects,
  paramFraction,
  rectFromPoints,
  snap,
} from "./layout";

function port(id: string, implicit = false) {
  return {
    id,
    name: id,
    kind: "continuous" as const,
    role: "any" as const,
    doc: "",
    implicit,
    // As the catalogue has it: an implicit `param:<id>` port names the param it feeds.
    ...(implicit ? { param: id.slice("param:".length) } : {}),
  };
}

function param(
  id: string,
  over: Partial<ModuleDescriptor["params"][number]> = {},
) {
  return {
    id,
    name: id,
    min: 0,
    max: 1,
    default: 0.5,
    unit: "none" as const,
    curve: "linear" as const,
    uiWidget: "slider" as const,
    doc: "",
    flags: {
      modulatable: true,
      integer: false,
      enum: false,
      hidden: false,
      noSmooth: false,
      structural: false,
      primary: true,
    },
    ...over,
  };
}

const vca: ModuleDescriptor = {
  id: "amp.vca",
  name: "VCA",
  category: "amp",
  doc: "",
  flags: {
    terminal: false,
    needsTransport: false,
    writesTelemetry: false,
    previewsWave: false,
    publishesScope: false,
    publishesValue: false,
    publishesMeter: false,
    publishesNotes: false,
    publishesKeys: false,
  },
  inputs: [port("in"), port("gain"), port("param:gain", true)],
  outputs: [port("out")],
  params: [param("gain")],
  texts: [],
  face: null,
};

describe("grid helpers", () => {
  it("snaps to a step, and does nothing when there is no step", () => {
    expect(snap(13, 8)).toBe(16);
    expect(snap(13, 0)).toBe(13);
  });

  it("builds a rectangle from corners dragged in any direction", () => {
    expect(rectFromPoints({ x: 30, y: 40 }, { x: 10, y: 10 })).toEqual({
      x: 10,
      y: 10,
      width: 20,
      height: 30,
    });
  });

  it("detects overlap for marquee selection", () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    expect(intersects(a, { x: 5, y: 5, width: 10, height: 10 })).toBe(true);
    expect(intersects(a, { x: 20, y: 0, width: 5, height: 5 })).toBe(false);
    // Touching edges do not overlap, or a marquee dragged up to a node would select it.
    expect(intersects(a, { x: 10, y: 0, width: 5, height: 5 })).toBe(false);
  });
});

describe("the controls a composed face shows", () => {
  it("shows the controls the module declared, and nothing else", () => {
    // The engine says which parameters belong on a face, because it is the only side that knows. The
    // interface has no way to tell that a cutoff is reached for more often than a formant spread.
    const plain = param("x").flags;
    const descriptor: ModuleDescriptor = {
      ...vca,
      params: [
        param("cutoff"),
        param("formant_spread", { flags: { ...plain, primary: false } }),
        param("resonance"),
        param("model", { flags: { ...plain, primary: false, enum: true } }),
      ],
    };
    expect(faceParams(descriptor).map((p) => p.id)).toEqual([
      "cutoff",
      "resonance",
    ]);
  });

  it("falls back to a guess for a module that declares no face at all", () => {
    // Better a plausible face than an empty one. This is what the interface did for every module
    // before the engine could say, and it is why an oscillator wore its detune controls.
    const plain = param("x").flags;
    const descriptor: ModuleDescriptor = {
      ...vca,
      params: [
        param("a", { flags: { ...plain, primary: false } }),
        param("b", { flags: { ...plain, primary: false } }),
        param("trim", {
          flags: { ...plain, primary: false, modulatable: false },
        }),
      ],
    };
    expect(faceParams(descriptor).map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("caps how many it shows, because a face is small and a module may have twenty", () => {
    const many: ModuleDescriptor = {
      ...vca,
      params: [1, 2, 3, 4, 5, 6, 7].map((n) => param(`p${n}`)),
    };
    expect(faceParams(many)).toHaveLength(4);
  });

  it("places a value between its ends for the arc to draw", () => {
    const p = param("gain", { min: -1, max: 1 });
    expect(paramFraction(p, 0)).toBeCloseTo(0.5, 5);
    expect(paramFraction(p, -1)).toBe(0);
    expect(paramFraction(p, 1)).toBe(1);
    // Out of range clamps rather than drawing an arc past the end of the track.
    expect(paramFraction(p, 99)).toBe(1);
  });
});

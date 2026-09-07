import type { ModuleDescriptor } from "@shared/protocol/catalog";
import { describe, expect, it } from "vitest";
import {
  CELL,
  faceParams,
  HEADER_HEIGHT,
  hitControl,
  hitNode,
  hitPort,
  intersects,
  KNOB_CELL_HEIGHT,
  measureNode,
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
    },
    ...over,
  };
}

const vca: ModuleDescriptor = {
  id: "amp.vca",
  name: "VCA",
  category: "amp",
  doc: "",
  flags: { terminal: false, needsTransport: false, writesTelemetry: false },
  inputs: [port("in"), port("gain"), port("param:gain", true)],
  outputs: [port("out")],
  params: [param("gain")],
};

describe("measuring a node", () => {
  it("is as tall as its longer column", () => {
    // A module with one input and six outputs must be six rows tall, not clipped to one.
    const tall: ModuleDescriptor = {
      ...vca,
      params: [],
      inputs: [port("in")],
      outputs: [1, 2, 3, 4, 5, 6].map((n) => port(`o${n}`)),
    };
    expect(measureNode(tall).rows).toBe(1 + 6);
    expect(measureNode(tall).height).toBe(HEADER_HEIGHT + 6 * CELL);
  });

  it("is always a whole number of grid cells", () => {
    // Every module is N by M cells and sits on cell boundaries, the way a rack unit occupies whole
    // units. Fractional sizes are what turn a patch of thirty modules into a collage.
    for (const descriptor of [vca, { ...vca, params: [] }]) {
      const layout = measureNode(descriptor);
      expect(layout.width % CELL).toBe(0);
      expect(layout.height % CELL).toBe(0);
      expect(layout.width).toBe(layout.cols * CELL);
      expect(layout.height).toBe(layout.rows * CELL);
    }
  });

  it("puts every socket on a half-cell line", () => {
    // So a cable between two modules an integer number of cells apart runs exactly horizontally
    // instead of a hair off.
    const layout = measureNode(vca);
    for (const p of [...layout.inputs, ...layout.outputs]) {
      expect((p.y - CELL / 2) % CELL).toBeCloseTo(0, 6);
    }
  });

  it("puts inputs on the left and outputs on the right", () => {
    const layout = measureNode(vca);
    expect(layout.inputs.every((p) => p.x === 0)).toBe(true);
    expect(layout.outputs.every((p) => p.x === layout.width)).toBe(true);
  });

  it("spaces ports one cell apart under the header", () => {
    const layout = measureNode(vca);
    expect(layout.inputs[0].y).toBe(HEADER_HEIGHT + CELL / 2);
    expect(layout.inputs[1].y - layout.inputs[0].y).toBe(CELL);
  });

  it("never gives an implicit modulation port a socket of its own", () => {
    // There is one per modulatable parameter. A wavetable oscillator has twenty-odd, so a socket each
    // makes the node taller than the patch it sits in. A cable is dropped on the knob instead.
    expect(measureNode(vca).inputs.map((p) => p.port.id)).toEqual([
      "in",
      "gain",
    ]);
  });

  it("tells each knob which port a cable dropped on it would connect to", () => {
    expect(measureNode(vca).controls[0].modulationPort).toBe("param:gain");
  });
});

describe("hit testing", () => {
  const layout = measureNode(vca);
  const origin = { x: 100, y: 50 };

  it("finds a node under a point inside it", () => {
    expect(hitNode({ x: 150, y: 70 }, origin, layout)).toBe(true);
    expect(hitNode({ x: 90, y: 70 }, origin, layout)).toBe(false);
  });

  it("finds a port near its socket", () => {
    const first = layout.inputs[0];
    const hit = hitPort(
      { x: origin.x + first.x + 2, y: origin.y + first.y + 2 },
      origin,
      layout,
    );
    expect(hit?.port.id).toBe("in");
  });

  it("finds nothing when the point is away from every socket", () => {
    expect(
      hitPort({ x: origin.x + 80, y: origin.y + 80 }, origin, layout),
    ).toBeNull();
  });

  it("picks the nearest socket rather than the first one in range", () => {
    // A generous grab radius makes neighbouring sockets overlap. Taking the first match would sometimes
    // connect the port above the one being aimed at.
    const second = layout.inputs[1];
    const hit = hitPort(
      { x: origin.x, y: origin.y + second.y - 1 },
      origin,
      layout,
    );
    expect(hit?.port.id).toBe("gain");
  });
});

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

describe("controls on a node's face", () => {
  it("shows the parameters meant to be moved while the patch runs", () => {
    // Modulatable means "designed to be driven", which is the same set a hardware module puts on its
    // panel. Trim parameters and enums belong in the inspector.
    const descriptor: ModuleDescriptor = {
      ...vca,
      params: [
        param("cutoff"),
        param("resonance"),
        param("model", {
          flags: { ...param("x").flags, modulatable: false, enum: true },
        }),
        param("trim", { flags: { ...param("x").flags, modulatable: false } }),
      ],
    };
    expect(faceParams(descriptor).map((p) => p.id)).toEqual([
      "cutoff",
      "resonance",
    ]);
  });

  it("caps how many it shows, because a face is small and a module may have twenty", () => {
    const many: ModuleDescriptor = {
      ...vca,
      params: [1, 2, 3, 4, 5, 6, 7].map((n) => param(`p${n}`)),
    };
    expect(faceParams(many)).toHaveLength(4);
  });

  it("grows the node wide enough for its controls", () => {
    const one = measureNode(vca).width;
    const four: ModuleDescriptor = {
      ...vca,
      params: [1, 2, 3, 4].map((n) => param(`p${n}`)),
    };
    expect(measureNode(four).width).toBeGreaterThan(one);
  });

  it("centres a single control rather than pinning it left", () => {
    const layout = measureNode(vca);
    expect(layout.controls[0].x).toBeCloseTo(layout.width / 2, 5);
  });

  it("is at least a knob tall even when it has few ports", () => {
    const shallow: ModuleDescriptor = {
      ...vca,
      inputs: [port("in")],
      outputs: [port("out")],
    };
    expect(measureNode(shallow).height).toBeGreaterThanOrEqual(
      HEADER_HEIGHT + KNOB_CELL_HEIGHT,
    );
  });

  it("finds the knob under a point", () => {
    const layout = measureNode(vca);
    const origin = { x: 10, y: 20 };
    const knob = layout.controls[0];
    expect(
      hitControl({ x: origin.x + knob.x, y: origin.y + knob.y }, origin, layout)
        ?.param.id,
    ).toBe("gain");
    expect(
      hitControl({ x: origin.x + 2, y: origin.y + 2 }, origin, layout),
    ).toBeNull();
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

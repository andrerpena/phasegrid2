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
  },
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

  it("puts every side socket on a half-cell line", () => {
    // So a cable between two modules an integer number of cells apart runs exactly horizontally
    // instead of a hair off.
    const layout = measureNode(vca);
    const side = [...layout.inputs, ...layout.outputs].filter(
      (p) => p.edge !== "bottom",
    );
    for (const p of side) {
      expect((p.y - CELL / 2) % CELL).toBeCloseTo(0, 6);
    }
  });

  it("puts inputs on the left and outputs on the right", () => {
    const layout = measureNode(vca);
    const side = layout.inputs.filter((p) => p.edge === "left");
    expect(side.every((p) => p.x === 0)).toBe(true);
    expect(layout.outputs.every((p) => p.x === layout.width)).toBe(true);
  });

  it("spaces ports one cell apart under the header", () => {
    const layout = measureNode(vca);
    expect(layout.inputs[0].y).toBe(HEADER_HEIGHT + CELL / 2);
    expect(layout.inputs[1].y - layout.inputs[0].y).toBe(CELL);
  });

  it("keeps implicit modulation ports out of the side column", () => {
    // There is one per modulatable parameter. A wavetable oscillator has twenty-odd, so a socket each
    // down the side makes the node taller than the patch it sits in. The ones on the face get a
    // socket under their knob instead; the rest are reached by dropping a cable on the knob.
    const side = measureNode(vca).inputs.filter((p) => p.edge === "left");
    expect(side.map((p) => p.port.id)).toEqual(["in", "gain"]);
  });

  it("gives every knob on the face a socket on the bottom border, right under it", () => {
    // Where a modulation cable plugs in, visibly and without hunting: below the control it moves.
    const layout = measureNode(vca);
    const socket = layout.inputs.find((p) => p.port.id === "param:gain");
    expect(socket).toBeDefined();
    if (socket === undefined) return;
    expect(socket.edge).toBe("bottom");
    expect(socket.side).toBe("input");
    expect(socket.x).toBe(layout.controls[0].x);
    expect(socket.y).toBe(layout.height);
    // Still a whole number of cells tall: the socket sits on the border, it does not add a row.
    expect(layout.height % CELL).toBe(0);
  });

  it("gives no bottom socket to a knob that cannot be modulated", () => {
    const plain = param("x").flags;
    const fixed: ModuleDescriptor = {
      ...vca,
      inputs: [port("in")],
      params: [param("trim", { flags: { ...plain, modulatable: false } })],
    };
    expect(
      measureNode(fixed).inputs.filter((p) => p.edge === "bottom"),
    ).toEqual([]);
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

  it("finds the socket under a knob", () => {
    const socket = layout.inputs.find((p) => p.edge === "bottom");
    expect(socket).toBeDefined();
    if (socket === undefined) return;
    const hit = hitPort(
      { x: origin.x + socket.x + 3, y: origin.y + socket.y - 2 },
      origin,
      layout,
    );
    expect(hit?.port.id).toBe("param:gain");
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

describe("a wave display on a node's face", () => {
  const osc = (
    params: ModuleDescriptor["params"],
    previewsWave = true,
  ): ModuleDescriptor => ({
    id: "osc.test",
    name: "Osc",
    category: "osc",
    doc: "",
    flags: {
      terminal: false,
      needsTransport: false,
      writesTelemetry: false,
      previewsWave,
    },
    inputs: [port("pitch")],
    outputs: [port("out")],
    params,
  });

  it("gives a display to the module that says it can draw itself, and to no other", () => {
    expect(measureNode(osc([param("level")])).display).not.toBeNull();
    expect(measureNode(osc([param("level")], false)).display).toBeNull();
    expect(measureNode(vca).display).toBeNull();
  });

  it("spends a control slot on the display rather than making the node wider", () => {
    // The point of the rule. A module that gains a picture shows one fewer knob; it does not grow, and
    // a patch of them stays the shape it was.
    const knobs = [param("a"), param("b"), param("c"), param("d")];
    const plain = measureNode(osc(knobs, false));
    const withDisplay = measureNode(osc(knobs));
    expect(withDisplay.cols).toBe(plain.cols);
    expect(withDisplay.controls).toHaveLength(plain.controls.length - 1);
  });

  it("puts the display in the first slot and shifts the knobs past it", () => {
    const plain = measureNode(osc([param("a"), param("b")], false));
    const withDisplay = measureNode(osc([param("a"), param("b")]));
    const display = withDisplay.display;
    expect(display).not.toBeNull();
    if (display === null) return;
    // The display sits where the first knob would have been, and the knobs start one slot later.
    expect(display.x).toBeLessThan(withDisplay.controls[0].x);
    expect(withDisplay.controls[0].x).toBeCloseTo(plain.controls[1].x, 5);
  });

  it("centres the display on the same line as the knobs beside it", () => {
    const layout = measureNode(osc([param("a")]));
    const display = layout.display;
    expect(display).not.toBeNull();
    if (display === null) return;
    expect(display.y + display.height / 2).toBeCloseTo(layout.controls[0].y, 5);
  });

  it("stands the node up on its own when the display is all it has", () => {
    const layout = measureNode(osc([]));
    expect(layout.controls).toHaveLength(0);
    expect(layout.display).not.toBeNull();
    // Still two cells of body: a node holding only a picture must not collapse to a title bar.
    expect(layout.height).toBe(HEADER_HEIGHT + KNOB_CELL_HEIGHT);
  });
});

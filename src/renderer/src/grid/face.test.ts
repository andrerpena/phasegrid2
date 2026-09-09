import type { ModuleDescriptor } from "@shared/protocol/catalog";
import { describe, expect, it } from "vitest";
import {
  composeFace,
  defaultFace,
  type Face,
  hitBlock,
  hitFace,
  hitKnob,
  hitSocket,
  JACK_SOCKET_DROP,
  KNOB_SHIFT,
  KNOB_SOCKET_INSET,
  parseFace,
  socketOf,
} from "./face";
import { CATALOG, descriptor } from "./fixtures";
import {
  CELL,
  KNOB_CELL_HEIGHT,
  KNOB_RADIUS,
  MIN_COLS,
  PORT_HIT_RADIUS,
  TILE_GUTTER,
  TITLE_HEIGHT,
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

/** A VCA-shaped module with no declared face, for the composed template. */
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

/** The same with one input, so a hand-written face can name `gain` without saying which one. */
const simple: ModuleDescriptor = {
  ...vca,
  inputs: [port("in"), port("param:gain", true)],
};

/** Every block's cells, so overlap can be checked without trusting the geometry that made them. */
function cellsCovered(face: Face): Map<string, string> {
  const covered = new Map<string, string>();
  for (const block of face.blocks)
    for (let r = block.row; r < block.row + block.rows; r++)
      for (let c = block.col; c < block.col + block.cols; c++)
        covered.set(`${r},${c}`, block.name);
  return covered;
}

describe("every module in the catalogue", () => {
  it("composes a face, declared or not, with no two blocks overlapping", () => {
    for (const module of CATALOG.modules) {
      const face = composeFace(module);
      expect(face.blocks.length, module.id).toBeGreaterThan(0);
      let cells = 0;
      for (const block of face.blocks) cells += block.cols * block.rows;
      expect(cellsCovered(face).size, module.id).toBe(cells);
      for (const block of face.blocks) {
        expect(block.col + block.cols, module.id).toBeLessThanOrEqual(
          face.cols,
        );
        expect(block.row + block.rows, module.id).toBeLessThanOrEqual(
          face.rows,
        );
      }
    }
  });

  it("gives every declared port exactly one jack, and no jack to an implicit one", () => {
    for (const module of CATALOG.modules) {
      const face = composeFace(module);
      const declared = module.inputs.filter((p) => !p.implicit);
      expect(face.jacks.length, module.id).toBe(
        declared.length + module.outputs.length,
      );
      for (const p of declared)
        expect(
          socketOf(face, p.id, "input"),
          `${module.id}.${p.id}`,
        ).not.toBeNull();
      for (const p of module.outputs)
        expect(
          socketOf(face, p.id, "output"),
          `${module.id}.${p.id}`,
        ).not.toBeNull();
      for (const jack of face.jacks)
        expect(jack.socket.port.implicit).toBe(false);
    }
  });

  it("is a whole number of cells, with the title a block across the top row and everything else below it", () => {
    for (const module of CATALOG.modules) {
      const face = composeFace(module);
      expect(face.width).toBe(face.cols * CELL);
      expect(face.height).toBe(face.rows * CELL);
      expect(face.blocks[0]).toBe(face.title);
      expect(face.title).toMatchObject({
        kind: "title",
        name: "title",
        col: 0,
        row: 0,
        cols: face.cols,
        rows: 1,
        x: 0,
        y: 0,
        width: face.width,
        height: TITLE_HEIGHT,
      });
      expect(
        face.blocks.slice(1).every((b) => b.y >= TITLE_HEIGHT),
        module.id,
      ).toBe(true);
    }
  });

  it("answers the same face object for the same descriptor", () => {
    const sine = descriptor("osc.sine");
    expect(composeFace(sine)).toBe(composeFace(sine));
  });
});

describe("a declared face", () => {
  const sine = descriptor("osc.sine");

  it("puts each block where the rows say", () => {
    const face = composeFace(sine);
    expect(sine.face).not.toBeNull();
    expect(face.cols).toBe(7);
    expect(face.rows).toBe(1 + 3);
    const wave = face.wave;
    expect(wave).not.toBeNull();
    // The face's first row is the module's second: the title is above it.
    expect(wave).toMatchObject({ col: 1, row: 1, cols: 3, rows: 2 });
    expect(face.knobs[0]).toMatchObject({
      name: "fold",
      col: 4,
      row: 1,
      cols: 2,
      rows: 2,
    });
    expect(face.jacks.map((j) => j.name)).toEqual([
      "reset",
      "out",
      "phase",
      "pitch",
    ]);
  });

  it("sits a jack's socket inside its tile, facing out of the column it is in", () => {
    const face = composeFace(sine);
    const reset = socketOf(face, "reset", "input");
    const out = socketOf(face, "out", "output");
    expect(reset).toMatchObject({
      x: CELL / 2,
      y: TITLE_HEIGHT + CELL / 2 + JACK_SOCKET_DROP,
      facing: "left",
    });
    expect(out).toMatchObject({
      x: face.width - CELL / 2,
      y: TITLE_HEIGHT + CELL / 2 + JACK_SOCKET_DROP,
      facing: "right",
    });
  });

  it("gives the knob a socket in its tile's bottom right corner for the implicit modulation port", () => {
    const face = composeFace(sine);
    const fold = face.knobs[0];
    expect(fold.modulationPort).toBe("param:fold");
    expect(fold.socket).toMatchObject({
      x: fold.x + fold.width - KNOB_SOCKET_INSET,
      y: fold.y + fold.height - KNOB_SOCKET_INSET,
      facing: "down",
    });
    expect(socketOf(face, "param:fold", "input")).toBe(fold.socket);
    // Clear of the knob and its arc.
    if (fold.socket === null) throw new Error("fold is modulatable");
    const gap = Math.hypot(
      fold.socket.x - fold.centre.x,
      fold.socket.y - fold.centre.y,
    );
    expect(gap).toBeGreaterThan(fold.radius + 3 + PORT_HIT_RADIUS);
  });

  it("faces a jack on the bottom row downward and one in the middle the way signal flows", () => {
    const rows = [
      ["in", "gain", "gain", "."],
      [".", "gain", "gain", "."],
      [".", "out", ".", "."],
    ];
    const face = parseFace(rows, simple);
    expect(socketOf(face, "out", "output")).toMatchObject({
      facing: "down",
      y: face.height - CELL / 2 + JACK_SOCKET_DROP,
    });
    const inside = parseFace(
      [
        [".", "in", ".", "."],
        [".", "gain", "gain", "."],
        [".", "gain", "gain", "out"],
      ],
      simple,
    );
    expect(socketOf(inside, "in", "input")?.facing).toBe("up");
  });

  it("refuses what the engine would refuse, so the two cannot disagree", () => {
    expect(() => parseFace([["in", "nope"]], simple)).toThrow(/names nothing/);
    expect(() =>
      parseFace(
        [
          ["in", "gain", "out"],
          [".", "gain", "."],
        ],
        simple,
      ),
    ).toThrow(/two cells by two/);
    expect(() =>
      parseFace(
        [
          ["in", "gain", "gain", "out"],
          ["gain", "gain", "gain", "."],
        ],
        simple,
      ),
    ).toThrow(/not a rectangle/);
    expect(() =>
      parseFace(
        [
          ["in", "gain", "gain", "."],
          [".", "gain", "gain", "."],
        ],
        simple,
      ),
    ).toThrow(/leaves out port `out`/);
    expect(() =>
      parseFace(
        [
          ["in", "wave", "wave", "out"],
          [".", "wave", "wave", "."],
        ],
        simple,
      ),
    ).toThrow(/cannot preview/);
  });

  it("scales a knob up with a bigger block", () => {
    const face = parseFace(
      [
        ["in", "gain", "gain", "gain", "out"],
        [".", "gain", "gain", "gain", "."],
        [".", "gain", "gain", "gain", "."],
      ],
      simple,
    );
    expect(face.knobs[0].radius).toBeCloseTo(KNOB_RADIUS * 1.5, 5);
  });
});

describe("a composed face", () => {
  it("is as tall as its longer column", () => {
    const tall: ModuleDescriptor = {
      ...vca,
      inputs: [port("a"), port("b"), port("c"), port("d")],
      params: [],
    };
    expect(defaultFace(tall).rows).toBe(1 + 4);
  });

  it("puts inputs down the left column and outputs down the right, a cell apart", () => {
    const face = defaultFace(vca);
    const inputs = face.jacks.filter((j) => j.socket.side === "input");
    expect(inputs.map((j) => j.socket.x)).toEqual([CELL / 2, CELL / 2]);
    expect(inputs.map((j) => j.socket.y)).toEqual([
      TITLE_HEIGHT + CELL / 2 + JACK_SOCKET_DROP,
      TITLE_HEIGHT + CELL * 1.5 + JACK_SOCKET_DROP,
    ]);
    expect(socketOf(face, "out", "output")).toMatchObject({
      x: face.width - CELL / 2,
      facing: "right",
    });
  });

  it("keeps implicit modulation ports out of the jack column, in their knob's tile instead", () => {
    const face = defaultFace(vca);
    expect(face.jacks.some((j) => j.name === "param:gain")).toBe(false);
    const knob = face.knobs[0];
    expect(knob.socket).toMatchObject({
      y: knob.y + knob.height - KNOB_SOCKET_INSET,
      facing: "down",
    });
  });

  it("gives no socket to a knob that cannot be modulated", () => {
    const fixed: ModuleDescriptor = {
      ...vca,
      inputs: [port("in")],
      params: [
        param("gain", { flags: { ...param("x").flags, modulatable: false } }),
      ],
    };
    const face = defaultFace(fixed);
    expect(face.knobs[0].modulationPort).toBeNull();
    expect(face.knobs[0].socket).toBeNull();
    expect(face.sockets).toHaveLength(2);
  });

  it("shows the controls the module declared primary, and nothing else", () => {
    const plain = param("x").flags;
    const face = defaultFace({
      ...vca,
      params: [
        param("cutoff"),
        param("formant_spread", { flags: { ...plain, primary: false } }),
        param("resonance"),
        param("model", { flags: { ...plain, primary: false, enum: true } }),
      ],
    });
    expect(face.knobs.map((k) => k.name)).toEqual(["cutoff", "resonance"]);
  });

  it("grows wide enough for its controls, and centres one knob rather than pinning it left", () => {
    const one = defaultFace(vca);
    const four = defaultFace({
      ...vca,
      params: [1, 2, 3, 4].map((n) => param(`p${n}`)),
    });
    expect(four.width).toBeGreaterThan(one.width);
    // The tile is centred; the knob sits a little left in it, leaving the corner for its socket.
    expect(one.knobs[0].x + one.knobs[0].width / 2).toBeCloseTo(
      one.width / 2,
      5,
    );
    expect(one.knobs[0].centre.x).toBeCloseTo(one.width / 2 - KNOB_SHIFT, 5);
    expect(one.cols).toBeGreaterThanOrEqual(MIN_COLS);
  });

  it("is at least a knob tall even with few ports", () => {
    const shallow: ModuleDescriptor = {
      ...vca,
      inputs: [port("in")],
      outputs: [port("out")],
    };
    expect(defaultFace(shallow).height).toBe(TITLE_HEIGHT + KNOB_CELL_HEIGHT);
  });

  it("gives a wave block to the module that can draw itself, first in the row, and to no other", () => {
    const osc = (previewsWave: boolean): ModuleDescriptor => ({
      ...vca,
      flags: { ...vca.flags, previewsWave },
      inputs: [port("pitch")],
      params: [param("a"), param("b")],
    });
    expect(defaultFace(osc(false)).wave).toBeNull();
    const face = defaultFace(osc(true));
    expect(face.wave).not.toBeNull();
    expect(face.wave?.col).toBeLessThan(face.knobs[0].col);
    expect(face.wave?.panel.width).toBe(
      (face.wave?.width ?? 0) - 2 * TILE_GUTTER,
    );
  });

  it("gives a scope block to the module that publishes one, ahead of its knobs, and refuses the token elsewhere", () => {
    const scoped: ModuleDescriptor = {
      ...vca,
      flags: { ...vca.flags, writesTelemetry: true, publishesScope: true },
      inputs: [port("in")],
      params: [param("time")],
    };
    const face = defaultFace(scoped);
    expect(face.scope).not.toBeNull();
    expect(face.wave).toBeNull();
    expect(face.scope?.col).toBeLessThan(face.knobs[0].col);
    expect(face.scope?.panel.width).toBe(
      (face.scope?.width ?? 0) - 2 * TILE_GUTTER,
    );
    // A face may say `scope` only on a module that has one to show.
    expect(() =>
      parseFace(
        [
          ["in", "scope", "scope"],
          [".", "scope", "scope"],
        ],
        vca,
      ),
    ).toThrow(/publishes none/);
    expect(() => parseFace([["in", "scope"]], scoped)).toThrow(
      /less than two cells by two/,
    );
  });

  it("draws the scope module the engine declares: a jack, the screen, the time knob", () => {
    const face = composeFace(descriptor("display.scope"));
    expect(face.blocks.map((b) => `${b.kind}:${b.name}`)).toEqual([
      "title:title",
      "jack:in",
      "scope:scope",
      "knob:time",
    ]);
    expect(face.scope).toMatchObject({ col: 1, row: 1, cols: 4, rows: 3 });
  });

  it("gives a readout to the module that publishes a value, and refuses the token elsewhere", () => {
    const readout: ModuleDescriptor = {
      ...vca,
      flags: { ...vca.flags, writesTelemetry: true, publishesValue: true },
      inputs: [port("in")],
      // A display module has no outputs: tapping a wire cannot change what it sounds like.
      outputs: [],
      params: [],
    };
    const face = defaultFace(readout);
    expect(face.readout).not.toBeNull();
    expect(face.knobs).toHaveLength(0);
    expect(() => parseFace([["in", "value", "value"]], vca)).toThrow(
      /publishes none/,
    );
    // A readout is a line of text: one cell tall is fine, one cell wide is not.
    expect(() => parseFace([["in", "value", "value"]], readout)).not.toThrow();
    expect(() => parseFace([["in", "value"]], readout)).toThrow(
      /less than two cells across/,
    );
  });

  it("draws the readout module the engine declares: a jack and the number", () => {
    const face = composeFace(descriptor("display.value"));
    expect(face.blocks.map((b) => `${b.kind}:${b.name}`)).toEqual([
      "title:title",
      "jack:in",
      "value:value",
    ]);
    expect(face.readout).toMatchObject({ col: 1, row: 1, cols: 3, rows: 2 });
    // A readout has no screen of its own: the number sits on an ordinary tile.
    expect(face.readout).not.toHaveProperty("panel");
  });

  it("gives a keyboard to the module that publishes keys, and refuses the token elsewhere", () => {
    const keyed: ModuleDescriptor = {
      ...vca,
      flags: { ...vca.flags, writesTelemetry: true, publishesKeys: true },
      inputs: [port("pitch"), port("gate")],
      outputs: [],
      params: [],
    };
    const face = defaultFace(keyed);
    expect(face.piano).not.toBeNull();
    expect(face.piano).toMatchObject({ cols: 6, rows: 2 });
    expect(() =>
      parseFace([["in", "piano", "piano", "piano", "piano"]], vca),
    ).toThrow(/publishes no keys/);
    // A keyboard is read across: four cells by two is the least that shows an octave.
    expect(() =>
      parseFace(
        [
          ["pitch", "piano", "piano", "piano", "piano"],
          ["gate", "piano", "piano", "piano", "piano"],
        ],
        keyed,
      ),
    ).not.toThrow();
    expect(() =>
      parseFace(
        [
          ["pitch", "piano", "piano", "piano"],
          ["gate", "piano", "piano", "piano"],
        ],
        keyed,
      ),
    ).toThrow(/less than four cells by two/);
  });

  it("draws the piano module the engine declares: two jacks, the keys and the octave knob", () => {
    const face = composeFace(descriptor("display.piano"));
    expect(face.blocks.map((b) => `${b.kind}:${b.name}`)).toEqual([
      "title:title",
      "jack:pitch",
      "piano:piano",
      "knob:octaves",
      "jack:gate",
    ]);
    expect(face.piano).toMatchObject({ col: 1, row: 1, cols: 7, rows: 2 });
    // The keys sit on an ordinary tile, like the meter's bars.
    expect(face.piano).not.toHaveProperty("panel");
  });

  it("draws the meter module the engine declares: a jack and the bars", () => {
    const face = composeFace(descriptor("display.meter"));
    expect(face.blocks.map((b) => `${b.kind}:${b.name}`)).toEqual([
      "title:title",
      "jack:in",
      "meter:meter",
    ]);
    expect(face.meter).toMatchObject({ col: 1, row: 1, cols: 3, rows: 2 });
  });

  it("stands a module up on its wave alone", () => {
    const face = defaultFace({
      ...vca,
      flags: { ...vca.flags, previewsWave: true },
      inputs: [port("pitch")],
      params: [],
    });
    expect(face.knobs).toHaveLength(0);
    expect(face.wave).not.toBeNull();
    expect(face.height).toBe(TITLE_HEIGHT + KNOB_CELL_HEIGHT);
  });
});

describe("hit testing", () => {
  const face = composeFace(descriptor("osc.sine"));
  const origin = { x: 100, y: 200 };

  it("finds the node under a point inside it, and not outside", () => {
    expect(hitFace({ x: 110, y: 210 }, origin, face)).toBe(true);
    expect(hitFace({ x: 99, y: 210 }, origin, face)).toBe(false);
  });

  it("finds a socket near it, and nothing away from every socket", () => {
    const out = socketOf(face, "out", "output");
    if (out === null) throw new Error("no out");
    const at = { x: origin.x + out.x + 3, y: origin.y + out.y - 3 };
    expect(hitSocket(at, origin, face)).toBe(out);
    expect(
      hitSocket({ x: origin.x + 60, y: origin.y + 12 }, origin, face),
    ).toBeNull();
  });

  it("picks the nearest socket rather than the first in range", () => {
    const reset = socketOf(face, "reset", "input");
    const phase = socketOf(face, "phase", "input");
    if (reset === null || phase === null) throw new Error("ports");
    // Just under the reset socket, inside the grab radius of both.
    const at = {
      x: origin.x + reset.x,
      y: origin.y + reset.y + PORT_HIT_RADIUS - 1,
    };
    expect(hitSocket(at, origin, face, CELL)).toBe(reset);
  });

  it("finds the knob under a point, and the block under any point", () => {
    const fold = face.knobs[0];
    const wave = face.wave;
    if (wave === null) throw new Error("the sine has a wave");
    const at = { x: origin.x + fold.centre.x + 4, y: origin.y + fold.centre.y };
    expect(hitKnob(at, origin, face)).toBe(fold);
    expect(hitBlock(at, origin, face)).toBe(fold);
    expect(
      hitKnob({ x: origin.x + 2, y: origin.y + 2 }, origin, face),
    ).toBeNull();
    // The title row is the title block.
    expect(hitBlock({ x: origin.x + 50, y: origin.y + 10 }, origin, face)).toBe(
      face.title,
    );
    expect(
      hitBlock(
        { x: origin.x + wave.x + 5, y: origin.y + wave.y + 5 },
        origin,
        face,
      ),
    ).toBe(face.wave);
  });
});

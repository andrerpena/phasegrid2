import { useCatalogStore } from "@renderer/catalog/catalog-store";
import { useEngineStore } from "@renderer/engine/engine-store";
import { usePatchStore } from "@renderer/patch/patch-store";
import { EMPTY_PATCH, type PatchDoc } from "@shared/protocol/patch";
import {
  type NotesReading,
  type SlotReading,
  TELEMETRY_CHANNELS,
  type TelemetryChannel,
  TelemetryKind,
} from "@shared/protocol/telemetry";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DESCRIPTORS, moduleNode } from "./fixtures";
import {
  displayModules,
  modulatedModules,
  previewedModules,
  startTelemetrySync,
} from "./telemetry-sync";

/**
 * Which modules get watched, and what a frame does with what they publish.
 *
 * The engine's half -- that a watched module publishes the values it used -- is tested there. Here
 * the questions are: is the right set asked for, at the right moments, and does a reading turn into
 * a knob position.
 */

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

/** An LFO into the sine's Fold, and the sine into the output. */
const MODULATED: PatchDoc = {
  ...EMPTY_PATCH,
  modules: [
    moduleNode("lfo", "mod.lfo"),
    moduleNode("osc", "osc.sine"),
    moduleNode("out", "io.audioOut"),
  ],
  edges: [
    {
      id: "e1",
      from: { module: "lfo", port: "out" },
      to: { module: "osc", port: "param:fold" },
    },
    {
      id: "e2",
      from: { module: "osc", port: "out" },
      to: { module: "out", port: "inL" },
    },
  ],
};

/** Every `watch` the sync has sent, as sent. */
const subscriptions: Record<string, TelemetryChannel[]>[] = [];
const live: [string, string, number | null][] = [];
const waves: [string, number[]][] = [];
const traces: [string, string, number[][]][] = [];
const shownValues: [string, string, number[]][] = [];
const levels: [string, string, number[], number[]][] = [];
let readings = new Map<number, SlotReading | null>();
let tick: (() => void) | null = null;
const opened: string[] = [];

beforeEach(() => {
  subscriptions.length = 0;
  noteReadings.length = 0;
  keyReadings.length = 0;
  live.length = 0;
  waves.length = 0;
  traces.length = 0;
  shownValues.length = 0;
  levels.length = 0;
  opened.length = 0;
  readings = new Map();
  tick = null;
  Object.assign(globalThis, {
    window: {
      engine: { onEvent: () => () => {} },
      telemetry: {
        open: (name: string) => {
          opened.push(name);
          return { slotCount: 64 };
        },
        read: (slot: number) => readings.get(slot) ?? null,
        close: () => {},
      },
    },
  });
  useEngineStore.setState({
    status: "ready",
    running: true,
    shm: { name: "/pg-test", size: 4096, layoutVersion: 1 },
    call: vi.fn(
      async (
        cmd: string,
        args: { watch?: Record<string, TelemetryChannel[]> },
      ) => {
        if (cmd === "telemetry.subscribe") {
          const watch = args.watch ?? {};
          subscriptions.push(watch);
          // Numbered the way the engine numbers them: modules in id order, channels in the enum's, so
          // a test that pins a slot number is pinning what the engine would really have answered.
          const slots: Record<
            string,
            Partial<Record<TelemetryChannel, number>>
          > = {};
          let next = 0;
          for (const moduleId of Object.keys(watch).sort()) {
            const given: Partial<Record<TelemetryChannel, number>> = {};
            for (const channel of TELEMETRY_CHANNELS)
              if (watch[moduleId].includes(channel)) given[channel] = next++;
            slots[moduleId] = given;
          }
          return { slots } as never;
        }
        return {} as never;
      },
    ) as never,
  });
  useCatalogStore.setState({ byId: DESCRIPTORS });
  usePatchStore.setState({ doc: MODULATED, version: 0 });
});

const noteReadings: [string, string, number][] = [];
const keyReadings: [string, string, number[]][] = [];

const target = {
  setLive: (module: string, param: string, fraction: number | null) =>
    live.push([module, param, fraction]),
  setWave: (module: string, samples: ArrayLike<number>) =>
    waves.push([module, Array.from(samples)]),
  setTrace: (module: string, index: bigint, channels: ArrayLike<number>[]) =>
    traces.push([module, index.toString(), channels.map((c) => Array.from(c))]),
  setValue: (module: string, index: bigint, values: number[]) =>
    shownValues.push([module, index.toString(), values]),
  setLevel: (
    module: string,
    index: bigint,
    level: { peak: number[]; rms: number[]; clipped: number[] },
  ) => levels.push([module, index.toString(), level.peak, level.clipped]),
  setNotes: (module: string, index: bigint, reading: NotesReading) =>
    noteReadings.push([module, index.toString(), reading.notes.length]),
  setKeys: (module: string, index: bigint, held: number[]) =>
    keyReadings.push([module, index.toString(), held]),
};

/** A keyboard, watched like the rest: what it shows is what it is for. */
const KEYED: PatchDoc = {
  ...MODULATED,
  modules: [...MODULATED.modules, moduleNode("keys", "display.piano")],
};

/** A meter on the sine, watched for the same reason a scope and a readout are. */
const METERED: PatchDoc = {
  ...MODULATED,
  modules: [...MODULATED.modules, moduleNode("level", "display.meter")],
  edges: [
    ...MODULATED.edges,
    {
      id: "e3",
      from: { module: "osc", port: "out" },
      to: { module: "level", port: "in" },
    },
  ],
};

/** A readout on the sine, watched for the same reason a scope is. */
const READOUT: PatchDoc = {
  ...MODULATED,
  modules: [...MODULATED.modules, moduleNode("readout", "display.value")],
  edges: [
    ...MODULATED.edges,
    {
      id: "e3",
      from: { module: "osc", port: "out" },
      to: { module: "readout", port: "in" },
    },
  ],
};

/**
 * An LFO into a pattern's Legato: a module that draws its own piano roll and has a knob modulation
 * turns. Both at once is the case one slot per module could not serve.
 */
const PATTERNED: PatchDoc = {
  ...EMPTY_PATCH,
  modules: [
    moduleNode("lfo", "mod.lfo"),
    moduleNode("pattern", "notes.pattern"),
  ],
  edges: [
    {
      id: "e1",
      from: { module: "lfo", port: "out" },
      to: { module: "pattern", port: "param:legato" },
    },
  ],
};

/** A scope on the sine, beside the modulated patch: it is watched with nothing plugged into it. */
const SCOPED: PatchDoc = {
  ...MODULATED,
  modules: [...MODULATED.modules, moduleNode("scope", "display.scope")],
  edges: [
    ...MODULATED.edges,
    {
      id: "e3",
      from: { module: "osc", port: "out" },
      to: { module: "scope", port: "in" },
    },
  ],
};
const schedule = (fn: () => void) => {
  tick = fn;
  return () => {
    tick = null;
  };
};

describe("which modules are watched", () => {
  it("is exactly the ones with a cable in a modulation socket, and which knob", () => {
    const wanted = modulatedModules(MODULATED, DESCRIPTORS);
    expect([...wanted.keys()]).toEqual(["osc"]);
    expect(wanted.get("osc")?.map((l) => l.param.id)).toEqual(["fold"]);
    expect(wanted.get("osc")?.[0].index).toBe(0);
  });

  it("is empty when every cable carries audio or control into an ordinary port", () => {
    const plain: PatchDoc = { ...MODULATED, edges: [MODULATED.edges[1]] };
    expect(modulatedModules(plain, DESCRIPTORS).size).toBe(0);
  });

  it("watches every module that shows something the engine publishes, cabled or not", () => {
    // The output wears a meter now, so it is watched wherever it is, and it is in every one of these.
    expect(displayModules(MODULATED, DESCRIPTORS)).toEqual(["out"]);
    expect(displayModules(SCOPED, DESCRIPTORS)).toEqual(["out", "scope"]);
    // A readout and a meter are watched by the same rule, and the three are one list.
    expect(displayModules(READOUT, DESCRIPTORS)).toEqual(["out", "readout"]);
    expect(displayModules(METERED, DESCRIPTORS)).toEqual(["level", "out"]);
    expect(displayModules(KEYED, DESCRIPTORS)).toEqual(["keys", "out"]);
    // Nothing modulates it, so the modulated set does not know it; the subscription has to merge.
    expect(modulatedModules(SCOPED, DESCRIPTORS).has("scope")).toBe(false);
  });

  it("asks for a picture from every module that has a panel, cabled or not", () => {
    // The LFO and the sine both draw their wave; the output does not. Modulation has nothing to do
    // with it: a face follows its knobs through the same path.
    expect(previewedModules(MODULATED, DESCRIPTORS)).toEqual(["lfo", "osc"]);
  });
});

describe("telemetry sync", () => {
  it("maps the engine's segment and asks it to watch the modulated modules", async () => {
    const sync = startTelemetrySync(target, schedule);
    await flush();
    sync.stop();
    expect(opened).toEqual(["/pg-test"]);
    // One request naming every pair: the sine's knobs, both wave panels, and the output's meter.
    expect(subscriptions).toEqual([
      { osc: ["params", "preview"], lfo: ["preview"], out: ["display"] },
    ]);
  });

  it("puts a published picture on the panel, and only a new one", async () => {
    const sync = startTelemetrySync(target, schedule);
    await flush();
    // Slot 0 is the LFO's picture, 1 the sine's knobs, 2 the sine's picture.
    readings.set(2, {
      kind: TelemetryKind.Preview,
      blockIndex: 7n,
      samples: Float32Array.from([-1, 0, 1]),
    });
    tick?.();
    tick?.();
    expect(waves).toEqual([["osc", [-1, 0, 1]]]);
    readings.set(2, {
      kind: TelemetryKind.Preview,
      blockIndex: 8n,
      samples: Float32Array.from([0, 1, 0]),
    });
    tick?.();
    expect(waves).toHaveLength(2);
    expect(waves[1]).toEqual(["osc", [0, 1, 0]]);
    sync.stop();
  });

  it("asks for a scope module by name with the modulated ones, and reads its slot as a trace", async () => {
    usePatchStore.setState({ doc: SCOPED, version: 0 });
    const sync = startTelemetrySync(target, schedule);
    await flush();
    expect(subscriptions.at(-1)).toEqual({
      osc: ["params", "preview"],
      lfo: ["preview"],
      out: ["display"],
      scope: ["display"],
    });
    // Slot 4 is the scope's display channel: 3 is the output's meter, and the modules are sorted: a window, not knob values.
    readings.set(4, {
      kind: TelemetryKind.Scope,
      blockIndex: 3n,
      channels: [
        Float32Array.from([0, 0.5, 0]),
        Float32Array.from([0, -0.5, 0]),
      ],
    });
    tick?.();
    tick?.();
    // Drawn once for one publish, however many frames look at it.
    expect(traces).toEqual([
      [
        "scope",
        "3",
        [
          [0, 0.5, 0],
          [0, -0.5, 0],
        ],
      ],
    ]);
    readings.set(4, {
      kind: TelemetryKind.Scope,
      blockIndex: 4n,
      channels: [Float32Array.from([1, 1, 1]), Float32Array.from([1, 1, 1])],
    });
    tick?.();
    expect(traces).toHaveLength(2);
    // Nothing is plugged into the scope's Time, so it holds no params channel and no knob to turn.
    expect(live.filter(([module]) => module === "scope")).toEqual([]);
    sync.stop();
  });

  it("reads a readout's slot as a value, from the same list as the scopes", async () => {
    usePatchStore.setState({ doc: READOUT, version: 0 });
    const sync = startTelemetrySync(target, schedule);
    await flush();
    expect(subscriptions.at(-1)).toEqual({
      osc: ["params", "preview"],
      lfo: ["preview"],
      out: ["display"],
      readout: ["display"],
    });
    // Slot 4 is the readout's, and it carries a Value rather than a window.
    readings.set(4, {
      kind: TelemetryKind.Value,
      blockIndex: 5n,
      values: [-0.25, 0.5],
    });
    tick?.();
    tick?.();
    expect(shownValues).toEqual([["readout", "5", [-0.25, 0.5]]]);
    expect(traces).toEqual([]);
    sync.stop();
  });

  it("reads a meter's slot as a level, from the same list again", async () => {
    usePatchStore.setState({ doc: METERED, version: 0 });
    const sync = startTelemetrySync(target, schedule);
    await flush();
    expect(subscriptions.at(-1)).toEqual({
      osc: ["params", "preview"],
      lfo: ["preview"],
      out: ["display"],
      level: ["display"],
    });
    // Slot 0 is the meter's: the modules are sorted, and `level` comes before `lfo` and `osc`.
    readings.set(0, {
      kind: TelemetryKind.Meter,
      blockIndex: 11n,
      peak: [0.8, 0.4],
      rms: [0.5, 0.25],
      clipped: [1, 0],
    });
    tick?.();
    tick?.();
    expect(levels).toEqual([["level", "11", [0.8, 0.4], [1, 0]]]);
    // The meter has no parameters at all, so it is watched on one channel and nothing feeds a knob.
    expect(live.filter(([module]) => module === "level")).toEqual([]);
    sync.stop();
  });

  it("keeps showing a scope's last window while the patch is held", async () => {
    usePatchStore.setState({ doc: SCOPED, version: 0 });
    const sync = startTelemetrySync(target, schedule);
    await flush();
    useEngineStore.setState({ running: false });
    readings.set(4, {
      kind: TelemetryKind.Scope,
      blockIndex: 9n,
      channels: [Float32Array.from([0.25])],
    });
    tick?.();
    // A held patch has no live knob values, but a window that arrives is still a window worth showing.
    expect(traces).toHaveLength(1);
    sync.stop();
  });

  it("turns a published value into a knob position, every frame", async () => {
    const sync = startTelemetrySync(target, schedule);
    await flush();
    // Fold runs 0..36 semitones; the engine says it is at 12 right now. Slot 1 is the sine's params.
    readings.set(1, {
      kind: TelemetryKind.Params,
      blockIndex: 1n,
      values: [12],
    });
    tick?.();
    expect(live).toEqual([["osc", "fold", 12 / 36]]);
    readings.set(1, {
      kind: TelemetryKind.Params,
      blockIndex: 2n,
      values: [24],
    });
    tick?.();
    expect(live.at(-1)).toEqual(["osc", "fold", 24 / 36]);
    sync.stop();
  });

  it("drives the knobs of a module that also draws itself", async () => {
    // The bug the channels exist for: a pattern publishes its own piano roll, which used to be the
    // whole of what its slot could carry, so the Legato an LFO was moving never moved on screen.
    usePatchStore.setState({ doc: PATTERNED, version: 0 });
    const sync = startTelemetrySync(target, schedule);
    await flush();
    expect(subscriptions.at(-1)).toEqual({
      lfo: ["preview"],
      pattern: ["params", "display"],
    });
    // Slot 0 is the LFO's picture, 1 the pattern's knobs, 2 its notes. Both of the pattern's arrive
    // in the same frame, from the two slots, and neither costs the other.
    readings.set(1, {
      kind: TelemetryKind.Params,
      blockIndex: 1n,
      // cycle, legato, transpose, gain. Legato runs 0.01..1, so 0.505 is half a turn.
      values: [4, 0.505, 0, 1],
    });
    readings.set(2, {
      kind: TelemetryKind.Notes,
      blockIndex: 6n,
      notes: [
        {
          start: 0,
          length: 0.5,
          pitch: 60,
          velocity: 1,
          from: 0,
          to: 2,
          textIndex: 0,
          sounding: true,
        },
      ],
      quartersPerCycle: 4,
      quartersPerBar: 4,
      phase: 0.5,
    });
    tick?.();
    expect(live).toHaveLength(1);
    expect(live[0][0]).toBe("pattern");
    expect(live[0][1]).toBe("legato");
    expect(live[0][2]).toBeCloseTo(0.5, 6);
    expect(noteReadings).toEqual([["pattern", "6", 1]]);
    sync.stop();
  });

  it("puts the knobs back where they are set when the patch is held", async () => {
    // Stop stops the patch, so there is nothing live: the last value is where the modulation happened
    // to stop rather than anything the knob means now. The pictures keep arriving, because the engine
    // draws those from what the patch is set to.
    const sync = startTelemetrySync(target, schedule);
    await flush();
    readings.set(1, {
      kind: TelemetryKind.Params,
      blockIndex: 1n,
      values: [12],
    });
    tick?.();
    expect(live).toEqual([["osc", "fold", 12 / 36]]);

    useEngineStore.setState({ running: false });
    expect(live.at(-1)).toEqual(["osc", "fold", null]);
    live.length = 0;
    readings.set(1, {
      kind: TelemetryKind.Params,
      blockIndex: 2n,
      values: [36],
    });
    readings.set(2, {
      kind: TelemetryKind.Preview,
      blockIndex: 5n,
      samples: Float32Array.from([1, 0, -1]),
    });
    tick?.();
    expect(live).toEqual([]);
    expect(waves).toEqual([["osc", [1, 0, -1]]]);
    sync.stop();
  });

  it("skips a frame whose slot was torn or not yet written", async () => {
    const sync = startTelemetrySync(target, schedule);
    await flush();
    readings.set(1, null);
    tick?.();
    expect(live).toEqual([]);
    sync.stop();
  });

  it("asks again when a cable is added or removed, and not when a knob moves", async () => {
    const sync = startTelemetrySync(target, schedule);
    await flush();
    usePatchStore
      .getState()
      .apply([{ op: "paramSet", module: "osc", param: "fold", value: 3 }]);
    await flush();
    expect(subscriptions).toHaveLength(1);
    usePatchStore.getState().apply([{ op: "edgeRemove", id: "e1" }]);
    await flush();
    sync.stop();
    // The sine's knobs are gone from the request; its picture is not, and nothing else changed.
    expect(subscriptions).toEqual([
      { osc: ["params", "preview"], lfo: ["preview"], out: ["display"] },
      { osc: ["preview"], lfo: ["preview"], out: ["display"] },
    ]);
  });

  it("asks once for a burst of edits that leave the set unchanged", async () => {
    const sync = startTelemetrySync(target, schedule);
    await flush();
    usePatchStore
      .getState()
      .apply([{ op: "moduleAdd", id: "extra", type: "amp.vca" }]);
    await flush();
    sync.stop();
    expect(subscriptions).toEqual([
      { osc: ["params", "preview"], lfo: ["preview"], out: ["display"] },
    ]);
  });

  /** A second LFO with the first one in its Shape socket: a watched module with room for more. */
  const withSecondLfo = (): void => {
    usePatchStore.setState({
      doc: {
        ...MODULATED,
        modules: [...MODULATED.modules, moduleNode("lfo2", "mod.lfo")],
        edges: [
          ...MODULATED.edges,
          {
            id: "e3",
            from: { module: "lfo", port: "out" },
            to: { module: "lfo2", port: "param:shape" },
          },
        ],
      },
      version: 0,
    });
  };

  it("drives a second knob on a module already watched, without asking the engine again", async () => {
    withSecondLfo();
    const sync = startTelemetrySync(target, schedule);
    await flush();
    expect(subscriptions).toEqual([
      {
        osc: ["params", "preview"],
        lfo: ["preview"],
        lfo2: ["params", "preview"],
        out: ["display"],
      },
    ]);
    usePatchStore.getState().apply([
      {
        op: "edgeAdd",
        id: "e4",
        from: { module: "lfo", port: "out" },
        to: { module: "lfo2", port: "param:depth" },
      },
    ]);
    await flush();
    // The engine publishes every parameter of a watched module, so it has nothing new to hear.
    expect(subscriptions).toHaveLength(1);
    // Slot 1 is lfo2's knobs: rate, shape, depth in descriptor order.
    readings.set(1, {
      kind: TelemetryKind.Params,
      blockIndex: 1n,
      values: [2, 0.5, 0.25],
    });
    tick?.();
    expect(live).toEqual([
      ["lfo2", "shape", 0.5],
      ["lfo2", "depth", 0.25],
    ]);
    sync.stop();
  });

  it("rests a knob whose cable was removed while its module stays watched", async () => {
    withSecondLfo();
    usePatchStore.getState().apply([
      {
        op: "edgeAdd",
        id: "e4",
        from: { module: "lfo", port: "out" },
        to: { module: "lfo2", port: "param:depth" },
      },
    ]);
    const sync = startTelemetrySync(target, schedule);
    await flush();
    usePatchStore.getState().apply([{ op: "edgeRemove", id: "e4" }]);
    await flush();
    // Told to rest at once, and not again: the engine still publishes a depth, and nothing
    // feeds it, so a value read for it would be a knob turning on its own.
    expect(live).toEqual([["lfo2", "depth", null]]);
    expect(subscriptions).toHaveLength(1);
    readings.set(1, {
      kind: TelemetryKind.Params,
      blockIndex: 1n,
      values: [2, 0.5, 0.25],
    });
    tick?.();
    expect(live.slice(1)).toEqual([["lfo2", "shape", 0.5]]);
    sync.stop();
  });
});

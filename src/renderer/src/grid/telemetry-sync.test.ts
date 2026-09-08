import { useCatalogStore } from "@renderer/catalog/catalog-store";
import { useEngineStore } from "@renderer/engine/engine-store";
import { usePatchStore } from "@renderer/patch/patch-store";
import { EMPTY_PATCH, type PatchDoc } from "@shared/protocol/patch";
import { type SlotReading, TelemetryKind } from "@shared/protocol/telemetry";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DESCRIPTORS, moduleNode } from "./fixtures";
import { modulatedModules, startTelemetrySync } from "./telemetry-sync";

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

const subscriptions: string[][] = [];
const live: [string, string, number | null][] = [];
let readings = new Map<number, SlotReading | null>();
let tick: (() => void) | null = null;
const opened: string[] = [];

beforeEach(() => {
  subscriptions.length = 0;
  live.length = 0;
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
    shm: { name: "/pg-test", size: 4096, layoutVersion: 1 },
    call: vi.fn(async (cmd: string, args: { modules?: string[] }) => {
      if (cmd === "telemetry.subscribe") {
        subscriptions.push(args.modules ?? []);
        const slots: Record<string, number> = {};
        (args.modules ?? []).forEach((m, i) => {
          slots[m] = i;
        });
        return { slots } as never;
      }
      return {} as never;
    }) as never,
  });
  useCatalogStore.setState({ byId: DESCRIPTORS });
  usePatchStore.setState({ doc: MODULATED, version: 0 });
});

const target = {
  setLive: (module: string, param: string, fraction: number | null) =>
    live.push([module, param, fraction]),
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
});

describe("telemetry sync", () => {
  it("maps the engine's segment and asks it to watch the modulated modules", async () => {
    const sync = startTelemetrySync(target, schedule);
    await flush();
    sync.stop();
    expect(opened).toEqual(["/pg-test"]);
    expect(subscriptions).toEqual([["osc"]]);
  });

  it("turns a published value into a knob position, every frame", async () => {
    const sync = startTelemetrySync(target, schedule);
    await flush();
    // Fold runs 0..48 semitones; the engine says it is at 12 right now.
    readings.set(0, {
      kind: TelemetryKind.Params,
      blockIndex: 1n,
      values: [12],
    });
    tick?.();
    expect(live).toEqual([["osc", "fold", 0.25]]);
    readings.set(0, {
      kind: TelemetryKind.Params,
      blockIndex: 2n,
      values: [24],
    });
    tick?.();
    expect(live.at(-1)).toEqual(["osc", "fold", 0.5]);
    sync.stop();
  });

  it("skips a frame whose slot was torn or not yet written", async () => {
    const sync = startTelemetrySync(target, schedule);
    await flush();
    readings.set(0, null);
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
    // Nothing left to watch: the engine is told so, or the old subscription would keep publishing.
    expect(subscriptions).toEqual([["osc"], []]);
  });

  it("asks once for a burst of edits that leave the set unchanged", async () => {
    const sync = startTelemetrySync(target, schedule);
    await flush();
    usePatchStore
      .getState()
      .apply([{ op: "moduleAdd", id: "extra", type: "amp.vca" }]);
    await flush();
    sync.stop();
    expect(subscriptions).toEqual([["osc"]]);
  });
});

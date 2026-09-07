import { useEngineStore } from "@renderer/engine/engine-store";
import { useHistoryStore } from "@renderer/history/history-store";
import { EMPTY_PATCH } from "@shared/protocol/patch";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendTransientParam, startEngineSync } from "./engine-sync";
import { usePatchStore } from "./patch-store";

/**
 * What the engine is told, and by which route.
 *
 * The route is the whole point. A parameter that travels inside `patch.batch` recompiles the graph
 * and, until recently, changed nothing audible; one that travels through `param.set` reaches the audio
 * thread's queue and is heard. These tests pin the route rather than the value.
 */

type Call = { cmd: string; args: unknown };

const calls: Call[] = [];
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  calls.length = 0;
  Object.assign(globalThis, {
    window: { engine: { onEvent: () => () => {} } },
  });
  useEngineStore.setState({
    call: vi.fn(async (cmd: string, args: unknown) => {
      calls.push({ cmd, args });
      return { revision: calls.length } as never;
    }) as never,
  });
  useHistoryStore.getState().clear();
  usePatchStore.setState({ doc: EMPTY_PATCH, version: 0 });
});

const add = { op: "moduleAdd" as const, id: "g", type: "amp.vca", x: 0, y: 0 };
const set = (value: number) => ({
  op: "paramSet" as const,
  module: "g",
  param: "gain",
  value,
});

describe("engine sync", () => {
  it("sends a parameter through param.set, never inside a batch", async () => {
    const stop = startEngineSync();
    usePatchStore.getState().apply([add]);
    usePatchStore.getState().apply([set(0.25)], { label: "Set parameter" });
    await flush();
    stop();

    expect(calls.map((c) => c.cmd)).toEqual(["patch.batch", "param.set"]);
    expect(calls[1].args).toEqual({ module: "g", param: "gain", value: 0.25 });
    // The batch carried the module and nothing about its gain.
    expect(JSON.stringify(calls[0].args)).not.toContain("paramSet");
  });

  it("sends the structural part of an edit before its parameters", async () => {
    // One edit that both adds a module and sets a value on it: the value can only land once the
    // module exists in the engine, so the order is not a preference.
    const stop = startEngineSync();
    usePatchStore.getState().apply([set(0.5), add]);
    await flush();
    stop();
    expect(calls.map((c) => c.cmd)).toEqual(["patch.batch", "param.set"]);
  });

  it("keeps edits in the order they were made, even across awaits", async () => {
    const stop = startEngineSync();
    usePatchStore.getState().apply([add, set(0.1)]);
    usePatchStore.getState().apply([{ op: "moduleRemove", id: "g" }]);
    await flush();
    await flush();
    stop();
    // Batch, its param, then the removal: never the removal ahead of the param it would orphan.
    expect(calls.map((c) => c.cmd)).toEqual([
      "patch.batch",
      "param.set",
      "patch.batch",
    ]);
  });

  it("sends a mid-gesture value to the engine and not to the document", () => {
    const before = usePatchStore.getState().doc;
    sendTransientParam("g", "gain", 0.7);
    expect(calls).toEqual([
      {
        cmd: "param.set",
        args: { module: "g", param: "gain", value: 0.7, transient: true },
      },
    ]);
    expect(usePatchStore.getState().doc).toBe(before);
    expect(useHistoryStore.getState().past).toHaveLength(0);
  });

  it("does not echo an edit that came from the engine", async () => {
    const stop = startEngineSync();
    usePatchStore.getState().apply([add], { source: "remote" });
    await flush();
    stop();
    expect(calls).toEqual([]);
  });
});

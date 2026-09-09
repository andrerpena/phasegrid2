import type { LiveGrid } from "@renderer/grid/grid-registry";
import { describe, expect, it } from "vitest";
import { createGridApi } from "./grid";
import { idle, waitFor } from "./idle";
import { buildSnapshot } from "./snapshot";

describe("the snapshot", () => {
  it("is plain data covering every part of the application", () => {
    const snap = buildSnapshot();
    expect(Object.keys(snap).sort()).toEqual(
      [
        "catalog",
        "config",
        "engine",
        "history",
        "layout",
        "log",
        "modals",
        "patch",
        "projects",
        "selection",
        "theme",
        "transport",
        "workspace",
      ].sort(),
    );
    // Serialisable: a debugger's `returnByValue` and `JSON.stringify` must both carry it whole.
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
    expect(snap.patch.modules).toEqual([]);
    expect(snap.transport.playing).toBe(false);
  });
});

describe("idle", () => {
  it("waits for the catalogue, flushes twice, and paints twice, in that order", async () => {
    const trace: string[] = [];
    let loading = 2;
    await idle({
      flush: async () => {
        trace.push("flush");
      },
      catalogLoading: () => loading-- > 0,
      frame: async () => {
        trace.push("frame");
      },
      sleep: async () => {
        trace.push("sleep");
      },
    });
    expect(trace).toEqual([
      "sleep",
      "sleep",
      "flush",
      "flush",
      "frame",
      "frame",
    ]);
  });
});

describe("waitFor", () => {
  it("returns once the predicate holds", async () => {
    let n = 0;
    await waitFor(
      () => ++n >= 3,
      {},
      async () => {},
    );
    expect(n).toBe(3);
  });

  it("throws with the label after the timeout", async () => {
    await expect(
      waitFor(
        () => false,
        { timeoutMs: 0, label: "the moon" },
        async () => {},
      ),
    ).rejects.toThrow("the moon");
  });
});

describe("grid geometry", () => {
  /** A renderer with one node at (48, 48), 144 by 96, one output and one knob, seen at 2x. */
  function fake(zoom = 2): LiveGrid {
    const node = {
      view: { position: { x: 48, y: 48 } },
      descriptor: { id: "osc.sine" },
      layout: {
        width: 144,
        height: 96,
        inputs: [
          { port: { id: "pitch" }, x: 0, y: 36, side: "input", edge: "left" },
        ],
        outputs: [
          { port: { id: "out" }, x: 144, y: 36, side: "output", edge: "right" },
        ],
        controls: [{ param: { id: "fold" }, x: 72, y: 60, radius: 16 }],
      },
    };
    const viewport = {
      x: 10,
      y: 20,
      zoom,
      toScreen: (p: { x: number; y: number }) => ({
        x: p.x * zoom + 10,
        y: p.y * zoom + 20,
      }),
    };
    return {
      renderer: { allNodes: () => new Map([["osc", node]]), viewport },
      canvas: {
        getBoundingClientRect: () => ({
          left: 300,
          top: 100,
          width: 800,
          height: 600,
        }),
      },
    } as unknown as LiveGrid;
  }

  it("answers null with no canvas rather than throwing", () => {
    const api = createGridApi({ live: () => null });
    expect(api.canvas()).toBeNull();
    expect(api.node("osc")).toBeNull();
    expect(api.nodes()).toEqual([]);
    expect(api.port("osc", "out")).toBeNull();
    expect(api.knob("osc", "fold")).toBeNull();
  });

  it("puts a node where the viewport and the canvas's place on the page say it is", () => {
    const api = createGridApi({ live: () => fake() });
    const node = api.node("osc");
    // 48 * 2 + 10 + 300 = 406; 48 * 2 + 20 + 100 = 216
    expect(node?.rect).toEqual({ x: 406, y: 216, width: 288, height: 192 });
    expect(node?.title).toEqual({ x: 406 + 144, y: 216 + 24 });
    expect(api.nodes()).toEqual([
      { id: "osc", type: "osc.sine", rect: node?.rect },
    ]);
  });

  it("finds a socket and a knob by name, scaled", () => {
    const api = createGridApi({ live: () => fake() });
    expect(api.port("osc", "out")).toEqual({
      x: 406 + 288,
      y: 216 + 72,
      side: "output",
      edge: "right",
    });
    expect(api.port("osc", "pitch")).toEqual({
      x: 406,
      y: 216 + 72,
      side: "input",
      edge: "left",
    });
    expect(api.port("osc", "pitch", "output")).toBeNull();
    expect(api.knob("osc", "fold")).toEqual({
      x: 406 + 144,
      y: 216 + 120,
      radius: 32,
    });
    expect(api.knob("osc", "level")).toBeNull();
  });
});

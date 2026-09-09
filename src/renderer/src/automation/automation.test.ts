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
  it("waits for the catalogue, flushes twice, waits for settings writes, then paints twice", async () => {
    const trace: string[] = [];
    let loading = 2;
    let saving = 1;
    await idle({
      flush: async () => {
        trace.push("flush");
      },
      catalogLoading: () => loading-- > 0,
      settingsSaving: () => saving-- > 0,
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
      "sleep",
      "frame",
      "frame",
    ]);
  });

  it("waits for a settings write even when nothing else is pending", async () => {
    // The case this exists for: a script types a setting and reads `workspace.json`. Without this
    // it reads the file as it was, and the failure looks like the setting never took.
    let saving = 3;
    const trace: string[] = [];
    await idle({
      flush: async () => {},
      catalogLoading: () => false,
      settingsSaving: () => saving-- > 0,
      frame: async () => {},
      sleep: async () => {
        trace.push("waited");
      },
    });
    expect(trace).toHaveLength(3);
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
    const pitch = {
      port: { id: "pitch" },
      side: "input",
      facing: "left",
      x: 0,
      y: 36,
    };
    const out = {
      port: { id: "out" },
      side: "output",
      facing: "right",
      x: 144,
      y: 36,
    };
    const fold = {
      kind: "knob",
      name: "fold",
      param: { id: "fold" },
      x: 48,
      y: 24,
      width: 48,
      height: 48,
      centre: { x: 72, y: 60 },
      radius: 16,
      socket: null,
    };
    const node = {
      view: { position: { x: 48, y: 48 } },
      descriptor: { id: "osc.sine" },
      face: {
        width: 144,
        height: 96,
        sockets: [pitch, out],
        knobs: [fold],
        blocks: [
          {
            kind: "jack",
            name: "pitch",
            x: 0,
            y: 24,
            width: 24,
            height: 24,
            socket: pitch,
          },
          fold,
        ],
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
      facing: "right",
    });
    expect(api.port("osc", "pitch")).toEqual({
      x: 406,
      y: 216 + 72,
      side: "input",
      facing: "left",
    });
    expect(api.port("osc", "pitch", "output")).toBeNull();
    expect(api.knob("osc", "fold")).toEqual({
      x: 406 + 144,
      y: 216 + 120,
      radius: 32,
    });
    expect(api.knob("osc", "level")).toBeNull();
  });

  it("lists every block on a face by name, with its box and what it holds", () => {
    const api = createGridApi({ live: () => fake() });
    const blocks = api.face("osc");
    expect(blocks?.map((b) => `${b.kind}:${b.name}`)).toEqual([
      "jack:pitch",
      "knob:fold",
    ]);
    // The jack at (0, 24) in a node at (48, 48), seen at 2x from (10, 20) on a canvas at (300, 100).
    expect(blocks?.[0].rect).toEqual({
      x: 406,
      y: 216 + 48,
      width: 48,
      height: 48,
    });
    expect(blocks?.[0].socket).toEqual({
      x: 406,
      y: 216 + 72,
      port: "pitch",
      side: "input",
      facing: "left",
    });
    expect(blocks?.[1].centre).toEqual({ x: 406 + 144, y: 216 + 120 });
    expect(blocks?.[1].socket).toBeUndefined();
    expect(createGridApi({ live: () => null }).face("osc")).toBeNull();
  });
});

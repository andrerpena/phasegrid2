import type { StorageKey } from "@shared/protocol/storage";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT, useLayoutStore } from "./layout-store";

const written = new Map<string, string>();

beforeEach(() => {
  written.clear();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      appStorage: {
        read: async (key: StorageKey) => ({
          ok: true,
          value: written.get(key) ?? null,
        }),
        write: async (key: StorageKey, text: string) => {
          written.set(key, text);
          return { ok: true, value: undefined };
        },
      },
    },
  });
  useLayoutStore.setState({ ...DEFAULT_LAYOUT, loaded: false });
});

describe("the layout", () => {
  it("stores sizes as ratios, so resizing the window rearranges nothing", () => {
    useLayoutStore.getState().setSize("leftWidth", 0.3);
    expect(useLayoutStore.getState().leftWidth).toBe(0.3);
  });

  it("never lets a drag collapse a panel to nothing", () => {
    // A panel dragged to zero cannot be dragged back, because there is nothing left to grab.
    useLayoutStore.getState().setSize("leftWidth", 0);
    expect(useLayoutStore.getState().leftWidth).toBeGreaterThan(0);
    useLayoutStore.getState().setSize("leftWidth", 5);
    expect(useLayoutStore.getState().leftWidth).toBeLessThan(1);
  });

  it("ignores a size that is not a number", () => {
    useLayoutStore.getState().setSize("rightWidth", Number.NaN);
    expect(Number.isFinite(useLayoutStore.getState().rightWidth)).toBe(true);
  });

  it("toggles a panel's visibility", () => {
    expect(useLayoutStore.getState().leftVisible).toBe(true);
    useLayoutStore.getState().toggle("leftVisible");
    expect(useLayoutStore.getState().leftVisible).toBe(false);
  });

  it("restores what was stored", async () => {
    written.set(
      "layout",
      JSON.stringify({ leftWidth: 0.35, rightVisible: false }),
    );
    await useLayoutStore.getState().load();
    const state = useLayoutStore.getState();
    expect(state.leftWidth).toBe(0.35);
    expect(state.rightVisible).toBe(false);
    // Anything the file did not mention keeps its default rather than becoming undefined.
    expect(state.rightWidth).toBe(DEFAULT_LAYOUT.rightWidth);
  });

  it("takes what it recognises from a file written by another build", async () => {
    // Restoring what it can beats discarding the whole layout, and beats trusting the whole file.
    written.set(
      "layout",
      JSON.stringify({ leftWidth: 0.4, somethingNew: 12, rightWidth: "wide" }),
    );
    await useLayoutStore.getState().load();
    expect(useLayoutStore.getState().leftWidth).toBe(0.4);
    expect(useLayoutStore.getState().rightWidth).toBe(
      DEFAULT_LAYOUT.rightWidth,
    );
  });

  it("clamps a stored size that is out of range", async () => {
    written.set("layout", JSON.stringify({ leftWidth: 0.99 }));
    await useLayoutStore.getState().load();
    expect(useLayoutStore.getState().leftWidth).toBeLessThan(0.95);
  });

  it("falls back to the default layout when the file is corrupt", async () => {
    written.set("layout", "{not json");
    await useLayoutStore.getState().load();
    const state = useLayoutStore.getState();
    expect(state.loaded).toBe(true);
    expect(state.leftWidth).toBe(DEFAULT_LAYOUT.leftWidth);
  });

  it("saves only the layout, not the functions on the store", async () => {
    useLayoutStore.getState().setSize("leftWidth", 0.25);
    await useLayoutStore.getState().save();
    const saved = JSON.parse(written.get("layout") ?? "{}") as Record<
      string,
      unknown
    >;
    expect(saved.leftWidth).toBe(0.25);
    expect(Object.keys(saved)).not.toContain("setSize");
    expect(Object.keys(saved)).not.toContain("loaded");
  });
});

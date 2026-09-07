import type { StorageKey } from "@shared/protocol/storage";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, useConfigStore } from "./config-store";

const written = new Map<string, string>();

beforeEach(() => {
  written.clear();
  vi.stubGlobal("window", {
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
  });
  useConfigStore.setState({
    defaults: DEFAULT_CONFIG,
    overrides: {},
    computed: DEFAULT_CONFIG,
    overridesText: "{}",
    parseError: null,
    loaded: false,
  });
});

describe("configuration", () => {
  it("reads a default when nothing overrides it", () => {
    expect(useConfigStore.getState().getNumber("grid.snap", 0)).toBe(8);
  });

  it("prefers an override over the default", () => {
    useConfigStore.getState().set("grid.snap", 16);
    expect(useConfigStore.getState().getNumber("grid.snap", 0)).toBe(16);
  });

  it("falls back when a value is the wrong type", () => {
    // A config file is user-editable, so a string where a number belongs is an ordinary event rather
    // than a broken installation. Every reader decides what to do about it once, here.
    useConfigStore.getState().set("grid.snap", "wide");
    expect(useConfigStore.getState().getNumber("grid.snap", 8)).toBe(8);
  });

  it("returns to the default when an override is removed", () => {
    useConfigStore.getState().set("grid.snap", 16);
    useConfigStore.getState().remove("grid.snap");
    expect(useConfigStore.getState().getNumber("grid.snap", 0)).toBe(8);
  });

  it("keeps running on the last good values while the text does not parse", () => {
    // This is the whole reason the raw text is stored beside the parsed object. Someone editing JSON
    // spends most of their keystrokes in states that do not parse; the application must not thrash.
    useConfigStore.getState().set("grid.snap", 16);
    useConfigStore.getState().setOverridesText('{"grid.snap": 3');
    const state = useConfigStore.getState();
    expect(state.parseError).not.toBeNull();
    expect(state.getNumber("grid.snap", 0)).toBe(16);
  });

  it("rejects text that parses but is not an object", () => {
    useConfigStore.getState().setOverridesText("[1, 2, 3]");
    expect(useConfigStore.getState().parseError).toBe(
      "configuration must be an object",
    );
  });

  it("clears the error once the text parses again", () => {
    useConfigStore.getState().setOverridesText("{ bad");
    useConfigStore.getState().setOverridesText('{"grid.snap": 32}');
    const state = useConfigStore.getState();
    expect(state.parseError).toBeNull();
    expect(state.getNumber("grid.snap", 0)).toBe(32);
  });

  it("persists the text that was typed, not a re-serialised copy of it", async () => {
    // Reopening should show what the person wrote, including keys they are not using yet. Saving the
    // parsed object instead would quietly delete their scratch work every time.
    useConfigStore.getState().setOverridesText('{\n  "grid.snap": 12\n}');
    await useConfigStore.getState().save();
    expect(written.get("config")).toBe('{\n  "grid.snap": 12\n}');
  });

  it("loads what was stored", async () => {
    written.set("config", '{"grid.snap": 24}');
    await useConfigStore.getState().load();
    expect(useConfigStore.getState().getNumber("grid.snap", 0)).toBe(24);
    expect(useConfigStore.getState().loaded).toBe(true);
  });

  it("starts on defaults when nothing has been stored", async () => {
    await useConfigStore.getState().load();
    expect(useConfigStore.getState().loaded).toBe(true);
    expect(useConfigStore.getState().getNumber("grid.snap", 0)).toBe(8);
  });
});

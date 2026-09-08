import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, useConfigStore } from "./config-store";

/** Stands in for the workspace's `workspace.json`. */
let stored: string | null = null;
let openWorkspace = true;

beforeEach(() => {
  stored = null;
  openWorkspace = true;
  vi.stubGlobal("window", {
    workspace: {
      readSettings: async () =>
        openWorkspace
          ? { ok: true, value: stored }
          : { ok: false, error: "no workspace is open" },
      writeSettings: async (text: string) => {
        if (!openWorkspace) return { ok: false, error: "no workspace is open" };
        stored = text;
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
    expect(stored).toBe('{\n  "grid.snap": 12\n}');
  });

  it("never writes text that does not parse", async () => {
    // What reaches the workspace file always loads again. Someone mid-keystroke has text that does
    // not, and the store keeps it on screen without ever putting it on disk.
    useConfigStore.getState().setOverridesText('{"grid.snap": 12}');
    useConfigStore.getState().setOverridesText('{"grid.snap": ');
    await Promise.resolve();
    expect(stored).toBe('{"grid.snap": 12}');
  });

  it("loads what the workspace had", async () => {
    stored = '{"grid.snap": 24}';
    await useConfigStore.getState().load();
    expect(useConfigStore.getState().getNumber("grid.snap", 0)).toBe(24);
    expect(useConfigStore.getState().loaded).toBe(true);
  });

  it("starts on defaults when the workspace has no settings", async () => {
    await useConfigStore.getState().load();
    expect(useConfigStore.getState().loaded).toBe(true);
    expect(useConfigStore.getState().getNumber("grid.snap", 0)).toBe(8);
  });

  it("forgets the previous workspace's settings when a load finds none", async () => {
    // Settings belong to the folder, so opening a folder that has none must show the defaults rather
    // than the last folder's answers.
    stored = '{"grid.snap": 24}';
    await useConfigStore.getState().load();
    stored = null;
    await useConfigStore.getState().load();
    expect(useConfigStore.getState().getNumber("grid.snap", 0)).toBe(8);
    expect(useConfigStore.getState().overridesText).toBe("{}");
  });

  it("keeps the defaults when there is no workspace yet", async () => {
    openWorkspace = false;
    await useConfigStore.getState().load();
    expect(useConfigStore.getState().getNumber("grid.snap", 0)).toBe(8);
  });
});

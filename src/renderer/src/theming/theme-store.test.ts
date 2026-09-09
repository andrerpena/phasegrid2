import { useConfigStore } from "@renderer/config/config-store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PhasegridTheme } from "./theme";
import { useThemeStore, watchTheme } from "./theme-store";
import { dark, light, THEMES } from "./themes";

/** A stand-in for the document, so these tests need no browser. */
function fakeRoot(): HTMLElement {
  return {
    style: { colorScheme: "" },
    dataset: {} as Record<string, string>,
  } as unknown as HTMLElement;
}

let stop: () => void = () => {};

beforeEach(() => {
  vi.stubGlobal("window", {
    workspace: {
      readSettings: async () => ({ ok: true, value: null }),
      writeSettings: async () => ({ ok: true, value: undefined }),
    },
  });
  useThemeStore.setState({ available: THEMES, theme: dark });
  useConfigStore.setState({
    overrides: {},
    computed: { ...useConfigStore.getState().defaults },
  });
});

afterEach(() => {
  stop();
  stop = () => {};
});

describe("the active theme", () => {
  it("is the default until something says otherwise", () => {
    expect(useThemeStore.getState().theme.id).toBe("dark");
  });

  it("follows the workspace's `ui.theme` setting", () => {
    // The setting was documented, validated and completed by the settings editor while nothing read
    // it. This is what makes it mean something.
    useConfigStore.setState({
      computed: { ...useConfigStore.getState().computed, "ui.theme": "light" },
    });
    stop = watchTheme(fakeRoot());
    expect(useThemeStore.getState().theme.id).toBe("light");
  });

  it("follows a later change to the setting, because a workspace opens after startup", () => {
    stop = watchTheme(fakeRoot());
    expect(useThemeStore.getState().theme.id).toBe("dark");
    useConfigStore.setState({
      computed: {
        ...useConfigStore.getState().computed,
        "ui.theme": "terminal",
      },
    });
    expect(useThemeStore.getState().theme.id).toBe("terminal");
  });

  it("falls back to the default for a theme this build does not have", () => {
    useConfigStore.setState({
      computed: {
        ...useConfigStore.getState().computed,
        "ui.theme": "nonesuch",
      },
    });
    stop = watchTheme(fakeRoot());
    expect(useThemeStore.getState().theme.id).toBe("dark");
  });

  it("names the theme on the document, and follows it", () => {
    const root = fakeRoot();
    stop = watchTheme(root);
    expect(root.dataset.theme).toBe("dark");
    useThemeStore.getState().setTheme("light");
    expect(root.dataset.theme).toBe("light");
    expect(root.style.colorScheme).toBe("light");
  });
});

describe("the set of themes", () => {
  it("starts as the built-ins, which is what gets injected", () => {
    stop = watchTheme(fakeRoot());
    expect(useThemeStore.getState().available).toEqual(THEMES);
  });

  it("can be replaced, and re-resolves the active theme against the new set", () => {
    const custom: PhasegridTheme = { ...light, id: "dark", name: "My Dark" };
    stop = watchTheme(fakeRoot());
    expect(useThemeStore.getState().theme.name).toBe("Dark");
    // A workspace redefining the theme you are looking at must repaint, not leave you on a copy
    // nothing can reach.
    useThemeStore.getState().setAvailable([custom]);
    expect(useThemeStore.getState().theme.name).toBe("My Dark");
  });

  it("keeps you somewhere when the new set does not have the theme you were on", () => {
    stop = watchTheme(fakeRoot());
    useThemeStore.getState().setTheme("terminal");
    useThemeStore.getState().setAvailable([light]);
    // Whatever it lands on has to be *in* the set: a theme outside it has no injected stylesheet
    // block, and the window would paint unstyled.
    expect(useThemeStore.getState().theme.id).toBe("light");
  });

  it("still has a theme when the set is emptied", () => {
    stop = watchTheme(fakeRoot());
    useThemeStore.getState().setAvailable([]);
    expect(useThemeStore.getState().theme.id).toBe("dark");
  });
});

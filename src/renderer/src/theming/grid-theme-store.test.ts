import { useConfigStore } from "@renderer/config/config-store";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useGridThemeStore, watchGridTheme } from "./grid-theme-store";
import { useThemeStore } from "./theme-store";
import { dark, light } from "./themes";

let stop: () => void = () => {};

beforeEach(() => {
  useThemeStore.getState().setTheme("dark");
  useConfigStore.setState({
    computed: { ...useConfigStore.getState().defaults },
  });
  stop = watchGridTheme();
});

afterEach(() => {
  stop();
});

function setThemeOverrides(theme: Record<string, string>): void {
  useConfigStore.setState({
    computed: { ...useConfigStore.getState().computed, theme },
  });
}

describe("the canvas palette", () => {
  it("is the active theme's when nothing overrides it", () => {
    expect(useGridThemeStore.getState().colors.gridLine).toBe(
      dark.grid.gridLine,
    );
  });

  it("follows the active theme", () => {
    useThemeStore.getState().setTheme("light");
    expect(useGridThemeStore.getState().colors.gridLine).toBe(
      light.grid.gridLine,
    );
  });

  it("takes a grid colour from the settings", () => {
    setThemeOverrides({ "grid.gridLine": "#ff0000" });
    expect(useGridThemeStore.getState().colors.gridLine).toBe("#ff0000");
    // Untouched roles keep the theme's value rather than being dropped.
    expect(useGridThemeStore.getState().colors.nodeFill).toBe(
      dark.grid.nodeFill,
    );
  });

  it("takes a signal colour from the settings", () => {
    setThemeOverrides({ "signal.audio": "#00ff88" });
    const { signal } = useGridThemeStore.getState().colors;
    expect(signal.audio).toBe("#00ff88");
    expect(signal.gate).toBe(dark.grid.signal.gate);
  });

  it("keeps an override across a theme switch", () => {
    setThemeOverrides({ "grid.marquee": "#123456" });
    useThemeStore.getState().setTheme("light");
    expect(useGridThemeStore.getState().colors.marquee).toBe("#123456");
  });

  it("ignores what it cannot draw", () => {
    setThemeOverrides({
      // Not a colour this build knows.
      "grid.nonesuch": "#ff0000",
      // A role that does not exist.
      "signal.smell": "#ff0000",
      // A CSS colour Pixi's hex parser would read as black.
      "grid.nodeFill": "oklch(0.5 0 0)",
      // Belongs to the stylesheet, not the canvas.
      "ui.background": "#ff0000",
    });
    const { colors } = useGridThemeStore.getState();
    expect(colors.nodeFill).toBe(dark.grid.nodeFill);
    expect(Object.keys(colors)).not.toContain("nonesuch");
    expect(Object.keys(colors.signal)).not.toContain("smell");
  });

  it("survives a theme key that is not an object", () => {
    useConfigStore.setState({
      computed: { ...useConfigStore.getState().computed, theme: "dark" },
    });
    expect(useGridThemeStore.getState().colors.gridLine).toBe(
      dark.grid.gridLine,
    );
  });
});

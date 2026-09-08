import { useConfigStore } from "@renderer/config/config-store";
import { create } from "zustand";
import type { GridColors, SignalColors } from "./theme";
import { useThemeStore } from "./theme-store";

/**
 * The colours the canvas draws with: the active theme's, plus whatever the settings file overrides.
 *
 * Separate from `theme-store` because these two answer different questions. The theme store answers
 * "which theme is on", and CSS handles the rest by itself. This one answers "what colour is a gate
 * cable right now", which no stylesheet can be asked, and which a person editing `workspace.json`
 * can change without switching theme at all.
 *
 * Overrides are flat dot-paths inside the config's `theme` object, so they read the way they are
 * written:
 *
 *     "theme": { "grid.gridLine": "#ff0000", "signal.audio": "#00ff88" }
 *
 * Anything unrecognised is ignored rather than rejected — a settings file that names a colour this
 * build removed should lose that one line, not fail to load.
 */

const GRID_PREFIX = "grid.";
const SIGNAL_PREFIX = "signal.";

interface GridThemeStore {
  colors: GridColors;
}

function isGridKey(key: string): key is keyof Omit<GridColors, "signal"> {
  const base = useThemeStore.getState().theme.grid;
  return key !== "signal" && Object.hasOwn(base, key);
}

function isSignalRole(role: string): role is keyof SignalColors {
  return Object.hasOwn(useThemeStore.getState().theme.grid.signal, role);
}

function compute(): GridColors {
  const base = useThemeStore.getState().theme.grid;
  const colors: GridColors = { ...base, signal: { ...base.signal } };

  const raw = useConfigStore.getState().computed.theme;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    return colors;

  for (const [path, value] of Object.entries(raw)) {
    // Only strings, and only hex: `hexToNumber` is the only parser on the Pixi side, so a colour it
    // cannot read would silently become black. Better to keep the theme's own value.
    if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) continue;

    if (path.startsWith(GRID_PREFIX)) {
      const key = path.slice(GRID_PREFIX.length);
      if (isGridKey(key)) colors[key] = value;
      continue;
    }
    if (path.startsWith(SIGNAL_PREFIX)) {
      const role = path.slice(SIGNAL_PREFIX.length);
      if (isSignalRole(role)) colors.signal[role] = value;
    }
    // `ui.*` paths are for CSS and are handled by the stylesheet, not here.
  }

  return colors;
}

export const useGridThemeStore = create<GridThemeStore>(() => ({
  colors: compute(),
}));

/**
 * Watches both inputs. Called once at startup; returns the way to stop, for tests.
 *
 * Two subscriptions rather than one, because the two sources change for unrelated reasons: switching
 * theme, and typing in the settings editor. Recomputing on either is what makes a colour typed into
 * `workspace.json` repaint the canvas without a reload.
 */
export function watchGridTheme(): () => void {
  const recompute = () => useGridThemeStore.setState({ colors: compute() });
  const stopTheme = useThemeStore.subscribe((state, previous) => {
    if (state.theme !== previous.theme) recompute();
  });
  const stopConfig = useConfigStore.subscribe((state, previous) => {
    if (state.computed.theme !== previous.computed.theme) recompute();
  });
  recompute();
  return () => {
    stopTheme();
    stopConfig();
  };
}

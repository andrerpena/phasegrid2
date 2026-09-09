import { useConfigStore } from "@renderer/config/config-store";
import { create } from "zustand";
import { applyTheme } from "./apply-theme";
import type { PhasegridTheme } from "./theme";
import { injectThemeVariables } from "./theme-variables";
import { DEFAULT_THEME_ID, THEMES, themeById } from "./themes";

interface ThemeState {
  theme: PhasegridTheme;
  /** Every theme that can be chosen: the built-ins, plus whatever the workspace defines. */
  available: PhasegridTheme[];
  setTheme: (id: string) => void;
  /** Replaces the set of themes. Called when the workspace's own themes change. */
  setAvailable: (themes: PhasegridTheme[]) => void;
}

/**
 * Looks an id up in a given set, falling back until something is found.
 *
 * The named theme, then the default, then whatever the set's first entry is — and only if the set is
 * empty, the built-in default. The order matters: the theme this returns must be *in* the set, or
 * there is no injected stylesheet block for it and the window paints unstyled. Falling straight
 * through to the built-in default was that bug.
 */
function pick(themes: PhasegridTheme[], id: string): PhasegridTheme {
  return (
    themes.find((t) => t.id === id) ??
    themes.find((t) => t.id === DEFAULT_THEME_ID) ??
    themes[0] ??
    themeById(DEFAULT_THEME_ID)
  );
}

/**
 * Which theme is on, and which ones there are.
 *
 * The store holds the answers and touches nothing else — no document, no stylesheet. `watchTheme`
 * below is what puts them on the page, the same way `watchEngine` connects a store to the world
 * elsewhere in this project. Keeping the store pure means a theme can be switched in a test without
 * a DOM, and means there is exactly one line in the codebase that writes `data-theme`.
 */
export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: themeById(DEFAULT_THEME_ID),
  // The built-ins are always there; a workspace's own themes are added to them, never instead of
  // them, so a settings file cannot leave you with nothing to switch to.
  available: THEMES,

  setTheme: (id) => set({ theme: pick(get().available, id) }),

  setAvailable: (themes) =>
    // The active theme is re-resolved against the new set, so a workspace that redefines the theme
    // you are looking at repaints rather than leaving you on a copy nothing can reach.
    set({ available: themes, theme: pick(themes, get().theme.id) }),
}));

/**
 * Puts the themes on the page, and keeps them there. Returns the way to stop.
 *
 * Three things follow the store: the generated stylesheet (when the set of themes changes), the
 * `data-theme` attribute (when the active one changes), and the `ui.theme` setting, which is what
 * makes a workspace open in the theme it was left in.
 */
export function watchTheme(root?: HTMLElement): () => void {
  const inject = () => injectThemeVariables(useThemeStore.getState().available);

  inject();
  applyTheme(useThemeStore.getState().theme, root);

  const stopStore = useThemeStore.subscribe((state, previous) => {
    if (state.available !== previous.available) inject();
    if (state.theme !== previous.theme) applyTheme(state.theme, root);
  });

  // The setting is the workspace's, so it arrives when a workspace opens rather than at startup —
  // which is why this follows the config rather than reading it once.
  const applySetting = () => {
    const id = useConfigStore
      .getState()
      .getString("ui.theme", DEFAULT_THEME_ID);
    if (id !== useThemeStore.getState().theme.id)
      useThemeStore.getState().setTheme(id);
  };
  applySetting();
  const stopConfig = useConfigStore.subscribe((state, previous) => {
    if (state.computed["ui.theme"] !== previous.computed["ui.theme"])
      applySetting();
  });

  return () => {
    stopStore();
    stopConfig();
  };
}

/**
 * Records the chosen theme in the workspace's settings.
 *
 * Separate from `setTheme` on purpose: the picker previews as you arrow through it, and writing the
 * settings file on every preview would put a dozen entries through the save path for one decision.
 * Only choosing calls this.
 */
export function rememberTheme(id: string): void {
  useConfigStore.getState().set("ui.theme", id);
}

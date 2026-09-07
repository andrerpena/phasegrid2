import { create } from "zustand";
import { applyTheme } from "./apply-theme";
import type { PhasegridTheme } from "./theme";
import { DEFAULT_THEME_ID, themeById } from "./themes";

interface ThemeState {
  theme: PhasegridTheme;
  setTheme: (id: string) => void;
}

/**
 * The active theme.
 *
 * Both consumers read this one store: CSS through the custom properties `applyTheme` writes, and the
 * Pixi surfaces by subscribing to the object itself. A canvas cannot read a CSS variable, which is why
 * the theme has to exist as data rather than only as a stylesheet.
 */
export const useThemeStore = create<ThemeState>((set) => ({
  theme: themeById(DEFAULT_THEME_ID),
  setTheme: (id) => {
    const theme = themeById(id);
    applyTheme(theme);
    set({ theme });
  },
}));

/** Called once at startup, before the first paint, so the window never flashes the wrong ground. */
export function initTheme(id: string = DEFAULT_THEME_ID): void {
  useThemeStore.getState().setTheme(id);
}

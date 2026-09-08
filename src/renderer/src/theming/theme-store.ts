import { create } from "zustand";
import { applyTheme } from "./apply-theme";
import type { PhasegridTheme } from "./theme";
import { DEFAULT_THEME_ID, themeById } from "./themes";

interface ThemeState {
  theme: PhasegridTheme;
  setTheme: (id: string) => void;
}

/**
 * Which theme is on.
 *
 * The store holds the answer and touches nothing else — no document, no stylesheet. `watchTheme`
 * below is what puts it on the page, the same way `watchEngine` and `startEngineSync` connect a
 * store to the world elsewhere in this project. Keeping the store pure means a test can switch
 * themes without a DOM, and means there is exactly one line in the codebase that writes
 * `data-theme`.
 */
export const useThemeStore = create<ThemeState>((set) => ({
  theme: themeById(DEFAULT_THEME_ID),
  setTheme: (id) => set({ theme: themeById(id) }),
}));

/** Puts the active theme on the document, and keeps it there. Returns the way to stop. */
export function watchTheme(root?: HTMLElement): () => void {
  applyTheme(useThemeStore.getState().theme, root);
  return useThemeStore.subscribe((state, previous) => {
    if (state.theme !== previous.theme) applyTheme(state.theme, root);
  });
}

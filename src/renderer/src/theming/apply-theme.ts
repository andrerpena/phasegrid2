import type { PhasegridTheme } from "./theme";

/**
 * Marks which theme is on. That is all it does.
 *
 * The values themselves live in `css/theme.css`, keyed off `[data-theme]`, so switching a theme is
 * one attribute write and a repaint — no loop over thirty custom properties, and no chance of the
 * document holding a half-applied palette. `colorScheme` goes with it so scrollbars and form
 * controls the platform draws follow the theme too.
 */
export function applyTheme(
  theme: PhasegridTheme,
  root: HTMLElement = document.documentElement,
): void {
  root.dataset.theme = theme.id;
  root.style.colorScheme = theme.type;
}

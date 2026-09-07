import type { PhasegridTheme } from "./theme";

/**
 * Writes a theme onto the document as custom properties, and marks which theme is active.
 *
 * This is the only place the JavaScript theme becomes CSS. Every stylesheet reads `var(--color-*)` and
 * none of them hardcode a colour, so switching themes is this one function and a repaint. The project
 * this shell is copied from kept a parallel stylesheet of the same values by hand; the two drifted, and
 * that is the specific failure this design removes rather than reproduces.
 */

/** `cardForeground` becomes `--color-card-foreground`. */
function cssName(key: string): string {
  return `--color-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

export function applyTheme(
  theme: PhasegridTheme,
  root: HTMLElement = document.documentElement,
): void {
  for (const [key, value] of Object.entries(theme.colors)) {
    root.style.setProperty(cssName(key), value);
  }
  // The grid's own colours are exposed too, so a legend, an inspector swatch and the canvas itself all
  // read one value. A port drawn green on the canvas and described in grey in a panel is a bug nobody
  // reports and everybody notices.
  for (const [role, value] of Object.entries(theme.grid.signal)) {
    root.style.setProperty(`--color-signal-${role}`, value);
  }
  root.style.setProperty("--color-grid-background", theme.grid.background);
  root.style.setProperty("--color-grid-line", theme.grid.gridLine);
  root.style.setProperty("--color-node-fill", theme.grid.nodeFill);
  root.style.setProperty("--color-node-stroke", theme.grid.nodeStroke);
  root.style.setProperty("--color-node-selected", theme.grid.nodeSelected);

  // `data-theme` is what a stylesheet keys off for the rare rule that cannot be expressed as a colour
  // swap, and what a screenshot test asserts on.
  root.dataset.theme = theme.type;
  root.style.colorScheme = theme.type;
}

/** Every custom property this writes, for a test that wants to check nothing was missed. */
export function themeCustomProperties(theme: PhasegridTheme): string[] {
  return [
    ...Object.keys(theme.colors).map(cssName),
    ...Object.keys(theme.grid.signal).map((r) => `--color-signal-${r}`),
    "--color-grid-background",
    "--color-grid-line",
    "--color-node-fill",
    "--color-node-stroke",
    "--color-node-selected",
  ];
}

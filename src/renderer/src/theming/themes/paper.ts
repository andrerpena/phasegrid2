import type { PhasegridTheme } from "../theme";

/**
 * E-ink. A warm paper ground, ink for everything drawn on it, and no light anywhere.
 *
 * An e-reader has sixteen greys and no colour, and this theme keeps to that: every surface is a
 * density of ink on the same paper, selection is inverted rather than lit, and the signal roles are
 * told apart by weight — audio the blackest, phase the faintest — the way a printed diagram tells its
 * lines apart. The one departure is red and amber, kept as the dull inks of a stamp rather than the
 * emitted colours of a screen, because an error and a warning still need to be found.
 *
 * As with `terminal`, the look is worth more here than reading a cable's role at a glance; the role
 * is readable from its endpoints anyway.
 */
export const paper: PhasegridTheme = {
  id: "paper",
  name: "Paper",
  type: "light",
  colors: {
    background: "oklch(0.945 0.008 85)",
    foreground: "oklch(0.2 0.006 85)",
    card: "oklch(0.965 0.007 85)",
    cardForeground: "oklch(0.2 0.006 85)",
    popover: "oklch(0.965 0.007 85)",
    popoverForeground: "oklch(0.2 0.006 85)",
    primary: "oklch(0.2 0.006 85)",
    primaryForeground: "oklch(0.965 0.007 85)",
    secondary: "oklch(0.9 0.009 85)",
    secondaryForeground: "oklch(0.2 0.006 85)",
    muted: "oklch(0.9 0.009 85)",
    mutedForeground: "oklch(0.48 0.008 85)",
    accent: "oklch(0.87 0.01 85)",
    accentForeground: "oklch(0.2 0.006 85)",
    destructive: "oklch(0.42 0.1 25)",
    destructiveForeground: "oklch(0.965 0.007 85)",
    border: "oklch(0.2 0.006 85 / 18%)",
    input: "oklch(0.2 0.006 85 / 24%)",
    ring: "oklch(0.35 0.006 85)",
    logInfo: "oklch(0.48 0.008 85)",
    logWarn: "oklch(0.45 0.07 70)",
    logError: "oklch(0.42 0.1 25)",
  },
  grid: {
    background: "#eeebe3",
    gridLine: "#e0ddd4",
    nodeFill: "#f6f4ee",
    nodeStroke: "#b6b2a8",
    nodeSelected: "#1c1b18",
    knobBody: "#e4e1d9",
    knobPointer: "#1c1b18",
    knobLabel: "#5d5a53",
    tileFill: "#ebe8e0",
    tileStroke: "#c8c4ba",
    marquee: "#1c1b18",
    playhead: "#3e3b35",
    signal: {
      any: "#8e8a81",
      audio: "#1c1b18",
      cv: "#34322d",
      gate: "#4b4842",
      pitch: "#5d5a53",
      phase: "#7d796f",
      note: "#6c685f",
    },
  },
};

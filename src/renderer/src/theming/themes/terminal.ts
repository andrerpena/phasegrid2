import type { PhasegridTheme } from "../theme";

/**
 * Phosphor. Black ground, green everything.
 *
 * The signal roles stay distinguishable but all sit in the green family, which is the trade this
 * theme is making: legibility of role is worth less here than the look, and a cable's role is
 * readable from its endpoints anyway.
 */
export const terminal: PhasegridTheme = {
  id: "terminal",
  name: "Terminal",
  type: "dark",
  colors: {
    background: "oklch(0.05 0 0)",
    foreground: "oklch(0.8 0.15 136)",
    card: "oklch(0.1 0.02 136)",
    cardForeground: "oklch(0.8 0.15 136)",
    popover: "oklch(0.08 0.02 136)",
    popoverForeground: "oklch(0.8 0.15 136)",
    primary: "oklch(0.75 0.18 136)",
    primaryForeground: "oklch(0.05 0 0)",
    secondary: "oklch(0.2 0.08 136)",
    secondaryForeground: "oklch(0.8 0.15 136)",
    muted: "oklch(0.15 0.05 136)",
    mutedForeground: "oklch(0.6 0.12 136)",
    accent: "oklch(0.15 0.05 136)",
    accentForeground: "oklch(0.8 0.15 136)",
    destructive: "oklch(0.6 0.25 25)",
    destructiveForeground: "oklch(0.05 0 0)",
    border: "oklch(0.3 0.1 136)",
    input: "oklch(0.25 0.08 136)",
    ring: "oklch(0.75 0.18 136)",
    logInfo: "oklch(0.6 0.12 136)",
    logWarn: "oklch(0.75 0.18 85)",
    logError: "oklch(0.6 0.25 25)",
  },
  grid: {
    background: "#000000",
    gridLine: "#0d2b0d",
    nodeFill: "#071a07",
    nodeStroke: "#1a5c1a",
    nodeSelected: "#00ff00",
    knobBody: "#0f3d0f",
    knobPointer: "#00ff00",
    knobLabel: "#00cc00",
    tileFill: "#0b260b",
    tileStroke: "#1a5c1a",
    marquee: "#00ff00",
    playhead: "#33ff33",
    signal: {
      any: "#008f2e",
      audio: "#00ff41",
      cv: "#7dff00",
      gate: "#c8ff00",
      pitch: "#a6ff2b",
      phase: "#00ffa6",
      note: "#3dff7a",
    },
  },
};

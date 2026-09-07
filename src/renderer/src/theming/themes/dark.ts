import type { PhasegridTheme } from "../theme";

/** The default. A grid editor is looked at for hours, so the ground is dark and the accents are few. */
export const dark: PhasegridTheme = {
  id: "dark",
  name: "Dark",
  type: "dark",
  colors: {
    background: "#0e0f11",
    foreground: "#e8e9ec",
    card: "#16181c",
    cardForeground: "#e8e9ec",
    popover: "#1b1e23",
    popoverForeground: "#e8e9ec",
    primary: "#e8e9ec",
    primaryForeground: "#16181c",
    secondary: "#24272e",
    secondaryForeground: "#e8e9ec",
    muted: "#24272e",
    mutedForeground: "#8a8f98",
    accent: "#2d323a",
    accentForeground: "#e8e9ec",
    destructive: "#e5484d",
    destructiveForeground: "#ffffff",
    border: "#2a2e35",
    input: "#1b1e23",
    ring: "#4d7cfe",
    logInfo: "#8a8f98",
    logWarn: "#f5a524",
    logError: "#e5484d",
  },
  grid: {
    background: "#0b0c0e",
    gridLine: "#191c21",
    nodeFill: "#1b1e23",
    nodeStroke: "#2f343c",
    nodeSelected: "#4d7cfe",
    marquee: "#4d7cfe",
    playhead: "#f5a524",
    // These are the seven signal roles the engine declares. They are also written out as
    // `--color-signal-*` custom properties, so a legend in the interface and a cable on the canvas
    // cannot end up different colours.
    signal: {
      any: "#8a8f98",
      audio: "#e5484d",
      cv: "#f76b15",
      gate: "#ffd230",
      pitch: "#f5a524",
      phase: "#a276f2",
      note: "#46b17b",
    },
  },
};

/**
 * The theme, twice.
 *
 * Colours exist in two places on purpose. `css/theme.css` declares them as custom properties, which
 * is what lets Tailwind's `@theme` block turn them into utility classes — `bg-background`,
 * `text-muted-foreground`, `border-border` — and a utility class is the whole point of using
 * Tailwind. The objects below hold the same values again, because a Pixi canvas cannot read a
 * stylesheet and the grid renderer needs them as data.
 *
 * Two copies of the same list is a thing that drifts. `theme-parity.test.ts` is the answer: it
 * parses `theme.css` and fails if any theme's block and its object disagree about a key or a value.
 * Change one, the test names the other.
 *
 * Naming is mechanical, and the test depends on it: a `UIColors` key becomes `--kebab-case`, a
 * `GridColors` key becomes `--grid-background` / `--grid-line` / `--node-fill` …, and a signal role
 * becomes `--signal-audio`.
 */

/** Interface colours. Every one is a custom property and a Tailwind colour of the same name. */
export interface UIColors {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  border: string;
  input: string;
  ring: string;
  /** Log levels, used by the log widget and the status bar. */
  logInfo: string;
  logWarn: string;
  logError: string;
}

/**
 * Every signal role the engine declares, in the colours the grid draws them.
 *
 * These mirror `SignalRole` in `engine/src/core/Descriptor.hpp`. A port's colour comes from its
 * descriptor, never from a table in the interface, so a new module type is drawn correctly without any
 * change here. `any` is the fallback for a role this build does not recognise.
 */
export interface SignalColors {
  any: string;
  audio: string;
  cv: string;
  gate: string;
  pitch: string;
  phase: string;
  note: string;
}

/**
 * What the Pixi surfaces read.
 *
 * Hex, not `oklch`, and not negotiable: `hexToNumber` in `lib/color.ts` is what turns a colour into
 * the integer Pixi wants, and it parses `#rrggbb` and nothing else. The interface colours above may
 * be any CSS colour because only CSS reads them; these may not.
 */
export interface GridColors {
  background: string;
  gridLine: string;
  nodeFill: string;
  nodeStroke: string;
  nodeSelected: string;
  /**
   * The knob body and its pointer.
   *
   * A knob is light and its pointer is dark, the way a physical one is. Drawing the body in the panel's
   * own colour makes the pointer disappear into it, which is the difference between a control you can
   * read across the window and a dark circle.
   */
  knobBody: string;
  knobPointer: string;
  knobLabel: string;
  /**
   * A block's tile: the filled key each block of a face sits on, and its hairline.
   *
   * A step lighter than the node, so the gutters between tiles show in the node's own colour and a
   * face reads as a panel of keys, the way a hardware surface does, rather than a frame with
   * controls floating in it.
   */
  tileFill: string;
  tileStroke: string;
  marquee: string;
  playhead: string;
  signal: SignalColors;
}

export interface PhasegridTheme {
  id: string;
  name: string;
  type: "light" | "dark";
  colors: UIColors;
  grid: GridColors;
}

/** `cardForeground` → `--card-foreground`. The one rule the parity test and `apply-theme` share. */
export function cssVarName(key: string): string {
  return `--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/** The custom property every `GridColors` key is declared as. */
export const GRID_VAR_NAMES: Record<keyof Omit<GridColors, "signal">, string> =
  {
    background: "--grid-background",
    gridLine: "--grid-line",
    nodeFill: "--node-fill",
    nodeStroke: "--node-stroke",
    nodeSelected: "--node-selected",
    knobBody: "--knob-body",
    knobPointer: "--knob-pointer",
    knobLabel: "--knob-label",
    tileFill: "--tile-fill",
    tileStroke: "--tile-stroke",
    marquee: "--marquee",
    playhead: "--playhead",
  };

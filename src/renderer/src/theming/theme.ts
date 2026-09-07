/**
 * The theme, as one JavaScript object.
 *
 * This is the single source. `apply-theme.ts` writes it onto the document as custom properties for CSS
 * to read, and the Pixi surfaces read the same object directly. There is deliberately no hand-written
 * stylesheet of colour variables to keep in step: the pattern this project is copied from had one, and
 * the two drifted apart, which is a class of bug that cannot happen if the values only exist once.
 */

/** Interface colours. Every one becomes `--color-<kebab-name>` on the document element. */
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

/** What the Pixi surfaces read. Hex strings; `hexToNumber` in `lib/color.ts` converts for Pixi. */
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

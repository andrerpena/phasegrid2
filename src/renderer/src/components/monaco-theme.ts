import { cssVariableToHex, isDark, withAlpha } from "@renderer/lib/css-color";
import type * as monaco from "monaco-editor/editor/editor.api";

/**
 * The settings editor, in the application's own colours.
 *
 * Monaco ships `vs` and `vs-dark`, and using them meant the editor was a standard dark-blue
 * rectangle sitting inside whatever the theme actually was — most obviously in the terminal theme,
 * where the chrome goes phosphor green and the editor did not.
 *
 * Every colour here comes from a custom property, resolved through the canvas trick in
 * `lib/css-color.ts` because Monaco's API takes hex and the palette is `oklch`. Re-derived whenever
 * `data-theme` changes, so switching theme repaints the editor with everything else.
 *
 * The syntax slots are deliberately few. A settings file is keys, strings, numbers and booleans, and
 * mapping those onto signal-role colours the rest of the application already uses means the editor
 * is recognisably part of it rather than merely not clashing.
 */

export const THEME_ID = "phasegrid";

/** What the editor needs, and what it falls back to when a property resolves to nothing. */
const TOKENS = {
  background: ["--background", "#0e0f11"],
  foreground: ["--foreground", "#e8e9ec"],
  muted: ["--muted", "#24272e"],
  mutedForeground: ["--muted-foreground", "#8a8f98"],
  popover: ["--popover", "#1b1e23"],
  popoverForeground: ["--popover-foreground", "#e8e9ec"],
  accent: ["--accent", "#2d323a"],
  accentForeground: ["--accent-foreground", "#e8e9ec"],
  border: ["--border", "#2a2e35"],
  ring: ["--ring", "#4d7cfe"],
  destructive: ["--destructive", "#e5484d"],
  // Keys, strings and numbers, in the roles the canvas draws the equivalent signals.
  key: ["--signal-phase", "#a276f2"],
  string: ["--signal-note", "#46b17b"],
  number: ["--signal-pitch", "#f5a524"],
  keyword: ["--signal-cv", "#f76b15"],
} as const satisfies Record<string, readonly [string, string]>;

type Palette = Record<keyof typeof TOKENS, string>;

function resolve(): Palette {
  const palette = {} as Palette;
  for (const [name, [variable, fallback]] of Object.entries(TOKENS) as [
    keyof typeof TOKENS,
    readonly [string, string],
  ][])
    palette[name] = cssVariableToHex(variable, fallback);
  return palette;
}

/** Monaco wants bare `rrggbb` for token foregrounds and `#rrggbb` for everything else. */
function bare(hex: string): string {
  return hex.replace(/^#/, "").slice(0, 6);
}

function define(instance: typeof monaco): void {
  const palette = resolve();

  instance.editor.defineTheme(THEME_ID, {
    base: isDark(palette.background) ? "vs-dark" : "vs",
    // `inherit: false`, or the base theme's own rules shadow these: `vs-dark` paints a JSON key
    // its own blue, which would win over the colour asked for here.
    inherit: false,
    rules: [
      { token: "", foreground: bare(palette.foreground) },
      { token: "string.key.json", foreground: bare(palette.key) },
      { token: "string.value.json", foreground: bare(palette.string) },
      { token: "string", foreground: bare(palette.string) },
      { token: "number", foreground: bare(palette.number) },
      { token: "keyword", foreground: bare(palette.keyword) },
      { token: "delimiter", foreground: bare(palette.mutedForeground) },
      { token: "comment", foreground: bare(palette.mutedForeground) },
    ],
    colors: {
      "editor.background": palette.background,
      "editor.foreground": palette.foreground,
      // Transparent, so the panel's own ground shows through and the editor has no edge of its own.
      "editorGutter.background": palette.background,
      "editorLineNumber.foreground": withAlpha(palette.mutedForeground, 0.6),
      "editorLineNumber.activeForeground": palette.foreground,
      "editor.lineHighlightBackground": withAlpha(palette.muted, 0.4),
      "editor.selectionBackground": withAlpha(palette.ring, 0.35),
      "editor.inactiveSelectionBackground": withAlpha(palette.ring, 0.18),
      "editorCursor.foreground": palette.foreground,
      "editorWidget.background": palette.popover,
      "editorWidget.foreground": palette.popoverForeground,
      "editorWidget.border": palette.border,
      "editorHoverWidget.background": palette.popover,
      "editorHoverWidget.border": palette.border,
      "editorSuggestWidget.background": palette.popover,
      "editorSuggestWidget.foreground": palette.popoverForeground,
      "editorSuggestWidget.border": palette.border,
      "editorSuggestWidget.selectedBackground": palette.accent,
      "editorSuggestWidget.selectedForeground": palette.accentForeground,
      "editorSuggestWidget.highlightForeground": palette.ring,
      "editorError.foreground": palette.destructive,
      "editorWarning.foreground": palette.number,
      "editorIndentGuide.background1": withAlpha(palette.border, 0.6),
      "editorIndentGuide.activeBackground1": palette.border,
      "scrollbarSlider.background": withAlpha(palette.mutedForeground, 0.3),
      "scrollbarSlider.hoverBackground": withAlpha(
        palette.mutedForeground,
        0.5,
      ),
      "scrollbarSlider.activeBackground": withAlpha(
        palette.mutedForeground,
        0.7,
      ),
      focusBorder: palette.ring,
    },
  });
}

let watching = false;

/**
 * Defines the theme and keeps it current. Idempotent, so every editor can call it on mount.
 *
 * A `MutationObserver` rather than a subscription to the theme store, because what this reads is the
 * *resolved* value of a custom property: it has to run after the attribute is on the document and
 * the new values have cascaded, not when the store changed. Watching the attribute is watching
 * exactly that.
 */
export function installMonacoTheme(instance: typeof monaco): void {
  if (typeof document === "undefined") return;
  define(instance);
  if (watching) return;
  watching = true;

  const observer = new MutationObserver(() => define(instance));
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
}

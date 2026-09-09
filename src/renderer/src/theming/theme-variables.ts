import { cssVarName, GRID_VAR_NAMES, type PhasegridTheme } from "./theme";

/**
 * A theme, as the custom properties CSS reads it through.
 *
 * This is the one place the mapping from a theme object to variable names lives. The generator below
 * uses it to write the stylesheet, and `theme-parity.test.ts` uses it to check that Tailwind has been
 * told about every name — so the two cannot disagree about what a theme contains.
 *
 * The names are mechanical: a `UIColors` key becomes `--kebab-case`, a `GridColors` key its entry in
 * `GRID_VAR_NAMES`, and a signal role `--signal-<role>`.
 */
export function themeVariables(theme: PhasegridTheme): Map<string, string> {
  const variables = new Map<string, string>();
  for (const [key, value] of Object.entries(theme.colors))
    variables.set(cssVarName(key), value);
  for (const [key, value] of Object.entries(theme.grid)) {
    if (key === "signal") continue;
    variables.set(
      GRID_VAR_NAMES[key as keyof typeof GRID_VAR_NAMES],
      value as string,
    );
  }
  for (const [role, value] of Object.entries(theme.grid.signal))
    variables.set(`--signal-${role}`, value);
  return variables;
}

/** One theme's rule, keyed off `data-theme` so switching is an attribute write. */
export function generateThemeCSS(theme: PhasegridTheme): string {
  const declarations = [...themeVariables(theme)]
    .map(([name, value]) => `  ${name}: ${value};`)
    .join("\n");
  return `[data-theme="${theme.id}"] {\n${declarations}\n}`;
}

export function generateThemesCSS(themes: PhasegridTheme[]): string {
  return themes.map(generateThemeCSS).join("\n\n");
}

/** The element the generated stylesheet lives in, so a second call replaces the first. */
export const STYLE_ELEMENT_ID = "phasegrid-theme-variables";

/**
 * Puts the themes on the page.
 *
 * The palette exists once, in TypeScript, and this is what makes CSS able to read it — so adding a
 * colour is an edit to the theme objects and a line in the `@theme` block, rather than the same
 * values written out again in three `[data-theme]` blocks by hand.
 *
 * Called again whenever the set of themes changes, which is what lets a workspace define one. The
 * style element is replaced rather than appended to, so nothing accumulates.
 *
 * Runs before the first render. `css/theme.css` still carries the ground colours for the frame
 * before this executes — see the comment there.
 */
export function injectThemeVariables(themes: PhasegridTheme[]): void {
  // Nothing to inject into outside a browser. The generator above is what the tests assert on; this
  // is only the side effect, and a test that switches themes should not need a DOM to do it.
  if (typeof document === "undefined") return;

  const css = generateThemesCSS(themes);
  document.getElementById(STYLE_ELEMENT_ID)?.remove();
  if (css.trim() === "") return;

  const style = document.createElement("style");
  style.id = STYLE_ELEMENT_ID;
  style.textContent = css;
  // Last in the head, so a generated theme wins over the fallback in `theme.css` at equal
  // specificity -- which is how the fallback stays a fallback rather than a competing definition.
  document.head.appendChild(style);
}

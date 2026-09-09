import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateThemeCSS, themeVariables } from "./theme-variables";
import { themeMap } from "./themes";

/**
 * The theme's two halves, checked against each other.
 *
 * The values are not duplicated any more -- they live in `themes/*.ts` and reach the page as a
 * generated stylesheet -- so there is no palette to compare. What remains is the seam that can still
 * silently break: `css/theme.css` has to tell Tailwind about every colour, and a class Tailwind never
 * heard of produces no rule, which looks exactly like a class that produces the wrong one.
 *
 * Plus the two colours the stylesheet still carries as a pre-paint fallback.
 */

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "../css/theme.css"), "utf8");

/** The declarations inside the `@theme` block. */
const mapping = css.slice(
  css.indexOf("@theme"),
  css.indexOf("\n}", css.indexOf("@theme")),
);

/** The declarations in the bare `:root` fallback that carries the ground colours. */
function fallback(): Map<string, string> {
  const declarations = new Map<string, string>();
  // The last `:root` block in the file; the earlier one holds `--radius`.
  const at = css.lastIndexOf(":root {");
  const body = css.slice(css.indexOf("{", at) + 1, css.indexOf("}", at));
  for (const line of body.split("\n")) {
    const match = /^\s*(--[a-z0-9-]+)\s*:\s*(.+?);\s*$/.exec(line);
    if (match !== null) declarations.set(match[1], match[2]);
  }
  return declarations;
}

describe("the @theme block", () => {
  // Every theme declares the same keys -- the interfaces make that a compile error otherwise -- so
  // one theme's variable set is the whole surface Tailwind has to know about.
  const wanted = themeVariables(themeMap.dark);

  it("exposes every colour as a Tailwind utility", () => {
    const missing = [...wanted.keys()].filter(
      (name) => !mapping.includes(`--color-${name.slice(2)}: var(${name});`),
    );
    expect(missing, `unmapped in @theme: ${missing.join(", ")}`).toEqual([]);
  });

  it("maps nothing that no theme declares", () => {
    // A stale mapping is a class that resolves to nothing, which is worse than no class at all
    // because it looks deliberate.
    const mapped = [
      ...mapping.matchAll(/--color-([a-z0-9-]+): var\((--[a-z0-9-]+)\)/g),
    ].map((m) => m[2]);
    const extra = mapped.filter((name) => !wanted.has(name));
    expect(extra, `mapped but undeclared: ${extra.join(", ")}`).toEqual([]);
  });

  it("carries no palette values of its own", () => {
    // The whole point of the split: this block says what a colour is called, never what it is. A
    // literal here is a value that will drift. The `:root` fallback below it is the one exception
    // and is checked separately.
    expect(mapping).not.toMatch(/oklch\(/);
    expect(mapping.match(/#[0-9a-f]{3,8}\b/i)).toBeNull();
  });
});

describe("the pre-paint fallback", () => {
  const declared = fallback();
  const dark = themeVariables(themeMap.dark);

  it("agrees with the default theme", () => {
    for (const [name, value] of declared)
      expect(dark.get(name), name).toBe(value);
  });

  it("covers the colours that show before the script runs, and no more", () => {
    // Kept to the minimum on purpose: a colour with a fallback is a colour that can be missing from
    // the generated sheet and look fine.
    expect([...declared.keys()].sort()).toEqual([
      "--background",
      "--foreground",
    ]);
  });
});

describe("the generated stylesheet", () => {
  it("keys each theme off its own id", () => {
    for (const [id, theme] of Object.entries(themeMap))
      expect(generateThemeCSS(theme)).toContain(`[data-theme="${id}"]`);
  });

  it("writes every one of a theme's colours", () => {
    const generated = generateThemeCSS(themeMap.terminal);
    for (const [name, value] of themeVariables(themeMap.terminal))
      expect(generated, name).toContain(`${name}: ${value};`);
  });

  it("names a nested grid colour the way the mapping expects", () => {
    // `grid.gridLine` is `--grid-line`, not `--grid-grid-line`; `grid.signal.audio` is
    // `--signal-audio`. Mechanical, but not derivable from the key alone.
    const variables = themeVariables(themeMap.dark);
    expect(variables.get("--grid-line")).toBe(themeMap.dark.grid.gridLine);
    expect(variables.get("--signal-audio")).toBe(
      themeMap.dark.grid.signal.audio,
    );
    expect(variables.get("--card-foreground")).toBe(
      themeMap.dark.colors.cardForeground,
    );
  });
});

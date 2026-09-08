import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cssVarName, GRID_VAR_NAMES, type PhasegridTheme } from "./theme";
import { themeMap } from "./themes";

/**
 * The guard on the duplication.
 *
 * Colours are written twice — once in `css/theme.css` for Tailwind, once in `themes/*.ts` for Pixi —
 * and two lists of the same thing drift. This reads the stylesheet and insists that each theme's
 * block declares exactly the properties its object implies, with exactly the same values. Editing
 * one copy and not the other is a failing test rather than a colour that is subtly wrong in the
 * panel and right on the canvas.
 */

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "../css/theme.css"), "utf8");

/** The declarations inside the block whose selector list contains `[data-theme="<id>"]`. */
function blockFor(id: string): Map<string, string> {
  const marker = `[data-theme="${id}"]`;
  const at = css.indexOf(marker);
  if (at < 0) throw new Error(`theme.css declares no block for "${id}"`);
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  const declarations = new Map<string, string>();
  for (const line of css.slice(open + 1, close).split("\n")) {
    const match = /^\s*(--[a-z0-9-]+)\s*:\s*(.+?);\s*$/.exec(line);
    if (match !== null) declarations.set(match[1], match[2]);
  }
  return declarations;
}

/** Every custom property a theme object implies, as name → value. */
function expected(theme: PhasegridTheme): Map<string, string> {
  const wanted = new Map<string, string>();
  for (const [key, value] of Object.entries(theme.colors))
    wanted.set(cssVarName(key), value);
  for (const [key, value] of Object.entries(theme.grid)) {
    if (key === "signal") continue;
    wanted.set(
      GRID_VAR_NAMES[key as keyof typeof GRID_VAR_NAMES],
      value as string,
    );
  }
  for (const [role, value] of Object.entries(theme.grid.signal))
    wanted.set(`--signal-${role}`, value);
  return wanted;
}

describe.each(Object.keys(themeMap))("theme.css and themes/%s.ts", (id) => {
  const theme = themeMap[id as keyof typeof themeMap];
  const declared = blockFor(id);
  const wanted = expected(theme);

  it("declares every colour the theme object holds", () => {
    const missing = [...wanted.keys()].filter((name) => !declared.has(name));
    expect(
      missing,
      `${id}: theme.css is missing ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("declares nothing the theme object does not hold", () => {
    const extra = [...declared.keys()].filter((name) => !wanted.has(name));
    expect(
      extra,
      `${id}: theme.css declares unknown ${extra.join(", ")}`,
    ).toEqual([]);
  });

  it("agrees on every value", () => {
    const disagreements: string[] = [];
    for (const [name, value] of wanted) {
      const found = declared.get(name);
      if (found !== undefined && found !== value)
        disagreements.push(`${name}: css has "${found}", theme has "${value}"`);
    }
    expect(disagreements, `${id}: ${disagreements.join("; ")}`).toEqual([]);
  });
});

describe("the @theme block", () => {
  const mapping = css.slice(
    css.indexOf("@theme"),
    css.indexOf("\n}", css.indexOf("@theme")),
  );

  // Without this line Tailwind never learns the name, and `bg-foo` silently does nothing --
  // a class that produces no rule looks exactly like a class that produces the wrong one.
  it("exposes every colour as a Tailwind utility", () => {
    const missing = [...expected(themeMap.dark).keys()].filter(
      (name) => !mapping.includes(`--color-${name.slice(2)}: var(${name});`),
    );
    expect(missing, `unmapped in @theme: ${missing.join(", ")}`).toEqual([]);
  });
});

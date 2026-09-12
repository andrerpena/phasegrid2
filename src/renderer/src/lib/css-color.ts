/**
 * Any CSS colour, as hex.
 *
 * The palette is `oklch` for the interface, and some things that need a colour cannot read it:
 * Monaco's theme API takes hex strings, and so does Pixi. Rather than restricting the palette to
 * what the least capable consumer parses, this asks the browser — which already knows how to resolve
 * every colour syntax there is, including ones that do not exist yet.
 *
 * The trick, from Nubase: set the colour as a `background-color`, read back what `getComputedStyle`
 * says, and if that is a syntax no regex should be parsing, paint one pixel onto a canvas and read
 * the bytes. The canvas has done the colour-space conversion for us.
 *
 * Not for the canvas's own palette. Grid colours stay `#rrggbb` in the theme objects and are read
 * directly, which keeps that path pure and testable — this exists for the places that are handed a
 * *resolved* colour and have nowhere else to get it from.
 */

/** Shared, because creating an element and a canvas per colour is most of the cost. */
let probe: HTMLElement | null = null;
let context: CanvasRenderingContext2D | null = null;

function ensureProbe(): HTMLElement {
  if (probe?.isConnected === true) return probe;
  probe = document.createElement("span");
  // Out of the layout and out of the way. It must be in the document for `getComputedStyle` to
  // resolve a custom property against the cascade.
  probe.style.display = "none";
  document.body.appendChild(probe);
  return probe;
}

function ensureContext(): CanvasRenderingContext2D | null {
  if (context !== null) return context;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  context = canvas.getContext("2d", { willReadFrequently: true });
  return context;
}

/** `rgb(1 2 3)` / `rgba(1, 2, 3, 0.5)` → `#010203` / `#01020380`. */
function rgbToHex(value: string): string | null {
  const match = /rgba?\(([^)]+)\)/i.exec(value);
  if (match === null) return null;
  const parts = match[1].split(/[,\s/]+/).filter((p) => p !== "");
  const byte = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  const [r, g, b, a] = parts.map((p) => Number.parseFloat(p));
  if (r === undefined || g === undefined || b === undefined) return null;
  const base = `#${byte(r)}${byte(g)}${byte(b)}`;
  return a !== undefined && a < 1 ? `${base}${byte(a * 255)}` : base;
}

/**
 * Resolves a CSS colour — or a `var(--name)` reference — to `#rrggbb`, or `#rrggbbaa` when it is
 * translucent. Returns `fallback` when there is no document, or when the browser cannot make sense
 * of the input either.
 */
export function cssColorToHex(color: string, fallback = "#000000"): string {
  if (typeof document === "undefined") return fallback;

  const element = ensureProbe();
  // Cleared first: an invalid value leaves the previous one in place, which would silently return
  // the colour asked for last.
  element.style.backgroundColor = "";
  element.style.backgroundColor = color;
  const computed = getComputedStyle(element).backgroundColor;
  if (computed === "" || computed === "rgba(0, 0, 0, 0)") {
    // Transparent is both a legitimate answer and what an unparseable value produces. Telling them
    // apart is not worth a second probe; a colour that resolves to nothing is a fallback case.
    return color.trim() === "transparent" ? "#00000000" : fallback;
  }

  const direct = rgbToHex(computed);
  if (direct !== null) return direct;

  const ctx = ensureContext();
  if (ctx === null) return fallback;
  try {
    ctx.clearRect(0, 0, 1, 1);
    // Assigning an invalid `fillStyle` is a no-op, so the previous value would be read back. Setting
    // a known one first makes that case return transparent rather than the last colour asked for.
    ctx.fillStyle = "rgba(0,0,0,0)";
    ctx.fillStyle = computed;
    ctx.fillRect(0, 0, 1, 1);
    const [r = 0, g = 0, b = 0, a = 255] = ctx.getImageData(0, 0, 1, 1).data;
    const byte = (n: number) => n.toString(16).padStart(2, "0");
    const base = `#${byte(r)}${byte(g)}${byte(b)}`;
    return a < 255 ? `${base}${byte(a)}` : base;
  } catch {
    return fallback;
  }
}

/** The value of a custom property, resolved to hex. `--background` → `#0e0f11`. */
export function cssVariableToHex(name: string, fallback = "#000000"): string {
  return cssColorToHex(`var(${name}, ${fallback})`, fallback);
}

/**
 * Whether a colour is dark enough to want light text on it.
 *
 * Relative luminance, which is what decides a base theme rather than a guess from the theme's own
 * `type` — a workspace theme can declare `type: "dark"` and a pale background, and what matters here
 * is the pixel.
 */
export function isDark(hex: string): boolean {
  const clean = hex.replace(/^#/, "").slice(0, 6);
  if (clean.length < 6) return false;
  const channel = (at: number) =>
    Number.parseInt(clean.slice(at, at + 2), 16) / 255;
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4) < 0.5;
}

/** Overlays an alpha byte onto `#rrggbb`. Monaco wants `#rrggbbaa` for translucent tokens. */
export function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace(/^#/, "").slice(0, 6);
  if (clean.length < 6) return hex;
  const byte = Math.max(0, Math.min(255, Math.round(alpha * 255)))
    .toString(16)
    .padStart(2, "0");
  return `#${clean}${byte}`;
}

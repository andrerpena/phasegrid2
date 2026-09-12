/**
 * Parses `#RRGGBB` (or bare `RRGGBB`) into 8-bit components. Malformed input falls back to black rather
 * than throwing: the cost of a bad theme override should be a wrong pixel, not a blank window.
 *
 * Short form `#RGB` is deliberately not supported; the palette is long form throughout.
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 0, g: 0, b: 0 };
  const n = Number.parseInt(m[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

/** The same, as the 24-bit integer Pixi's colour arguments take. */
export function hexToNumber(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0;
  return Number.parseInt(m[1], 16);
}

/** Multiplies each channel by `factor`, clamped to 0..1. Used for hover and pressed states. */
export function darken(hex: string, factor = 0.6): string {
  const f = Math.max(0, Math.min(1, factor));
  const { r, g, b } = hexToRgb(hex);
  const ch = (c: number) =>
    Math.round(c * f)
      .toString(16)
      .padStart(2, "0");
  return `#${ch(r)}${ch(g)}${ch(b)}`;
}

/** Mixes two colours, `amount` 0 giving `a` and 1 giving `b`. */
export function mix(a: string, b: string, amount: number): string {
  const t = Math.max(0, Math.min(1, amount));
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  const ch = (p: number, q: number) =>
    Math.round(p + (q - p) * t)
      .toString(16)
      .padStart(2, "0");
  return `#${ch(x.r, y.r)}${ch(x.g, y.g)}${ch(x.b, y.b)}`;
}

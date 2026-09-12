import { describe, expect, it } from "vitest";
import { cssColorToHex, isDark, withAlpha } from "./css-color";

/**
 * The parts that do not need a browser.
 *
 * `cssColorToHex` asks the browser to resolve a colour, so outside one it can only be checked for
 * the promise it makes there: return the fallback rather than throw. What it does *with* a document
 * is exercised in the app — the settings editor's theme is derived through it, and the e2e checks
 * the editor's own colours change with the theme.
 */
describe("resolving a colour without a document", () => {
  it("returns the fallback rather than throwing", () => {
    expect(cssColorToHex("oklch(0.5 0 0)", "#123456")).toBe("#123456");
    expect(cssColorToHex("var(--nonesuch)", "#abcdef")).toBe("#abcdef");
  });

  it("defaults the fallback to black, which is a colour rather than a crash", () => {
    expect(cssColorToHex("nonsense")).toBe("#000000");
  });
});

describe("deciding light from dark", () => {
  it("reads the pixel, not the name", () => {
    // A workspace theme can declare `type: "dark"` over a pale background; what matters for
    // choosing a base editor theme is the luminance.
    expect(isDark("#000000")).toBe(true);
    expect(isDark("#0e0f11")).toBe(true);
    expect(isDark("#ffffff")).toBe(false);
    expect(isDark("#fbfbfc")).toBe(false);
  });

  it("weights green the way the eye does", () => {
    // Pure blue is dark, pure green is not, at the same numeric channel value.
    expect(isDark("#0000ff")).toBe(true);
    expect(isDark("#00ff00")).toBe(false);
  });

  it("treats something it cannot read as light, so text stays dark on it", () => {
    expect(isDark("#fff")).toBe(false);
    expect(isDark("")).toBe(false);
  });
});

describe("adding alpha", () => {
  it("appends the byte Monaco expects", () => {
    expect(withAlpha("#112233", 1)).toBe("#112233ff");
    expect(withAlpha("#112233", 0)).toBe("#11223300");
    expect(withAlpha("#112233", 0.5)).toBe("#11223380");
  });

  it("drops an alpha that is already there rather than stacking a second", () => {
    expect(withAlpha("#112233ff", 0.25)).toBe("#11223340");
  });

  it("leaves something it cannot read alone", () => {
    expect(withAlpha("#abc", 0.5)).toBe("#abc");
  });
});

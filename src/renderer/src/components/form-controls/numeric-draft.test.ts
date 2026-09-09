import { describe, expect, it } from "vitest";
import { acceptable, parseNumeric, settle } from "./numeric-draft";

describe("what a field's text is as a number", () => {
  it("is nothing while the text is not a number yet", () => {
    for (const text of ["", " ", "-", "1e", "abc", "."])
      expect(parseNumeric(text), JSON.stringify(text)).toBeNull();
  });

  it("is the number once there is one", () => {
    expect(parseNumeric("0")).toBe(0);
    expect(parseNumeric("137")).toBe(137);
    expect(parseNumeric("0.")).toBe(0);
    expect(parseNumeric("-2.5")).toBe(-2.5);
  });
});

describe("what is handed on while typing", () => {
  it("holds the digits on the way into a range, so a tempo never visits its minimum", () => {
    const tempo = { min: 20, max: 400 };
    expect(acceptable(1, tempo)).toBe(false);
    expect(acceptable(13, tempo)).toBe(false);
    expect(acceptable(137, tempo)).toBe(true);
    expect(acceptable(4000, tempo)).toBe(false);
  });

  it("hands on anything finite when there is no range", () => {
    expect(acceptable(-1e6, {})).toBe(true);
    expect(acceptable(Number.NaN, {})).toBe(false);
  });

  it("holds a fraction where only whole numbers are values", () => {
    expect(acceptable(3.5, { integer: true })).toBe(false);
    expect(acceptable(3, { integer: true })).toBe(true);
  });
});

describe("what is committed when the field is left", () => {
  it("goes back to what it had when the field was emptied, rather than to zero", () => {
    expect(settle("", 0.9, {})).toBe(0.9);
    expect(settle("-", 120, { min: 20, max: 400 })).toBe(120);
  });

  it("clamps into the range", () => {
    expect(settle("4000", 120, { min: 20, max: 400 })).toBe(400);
    expect(settle("1", 120, { min: 20, max: 400 })).toBe(20);
  });

  it("rounds where only whole numbers are values", () => {
    expect(settle("3.6", 4, { min: 1, max: 64, integer: true })).toBe(4);
    expect(settle("0.2", 4, { min: 1, max: 64, integer: true })).toBe(1);
  });
});

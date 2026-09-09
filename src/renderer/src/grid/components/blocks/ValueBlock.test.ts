import { describe, expect, it } from "vitest";
import { formatSignal, readoutLines } from "./ValueBlock";

describe("a signal as a number", () => {
  it("always carries its sign, so a reading is never mistaken for its opposite", () => {
    expect(formatSignal(0.5)).toBe("+0.500");
    expect(formatSignal(-0.5)).toBe("-0.500");
  });

  it("shows a signal that is off as zero rather than as minus zero", () => {
    // -0 is a real float and `toFixed` prints its sign. A minus on a silent wire reads as a fault.
    expect(formatSignal(-0)).toBe("+0.000");
    expect(formatSignal(0)).toBe("+0.000");
  });

  it("gives decimals up as the magnitude grows, so the string stays the same width", () => {
    expect(formatSignal(1.23456)).toBe("+1.235");
    expect(formatSignal(42.5)).toBe("+42.50");
    expect(formatSignal(440)).toBe("+440.0");
    expect(formatSignal(48000)).toBe("+48000");
  });

  it("says when a patch has blown up rather than drawing a plausible number", () => {
    expect(formatSignal(Number.NaN)).toBe("nan");
    expect(formatSignal(Number.POSITIVE_INFINITY)).toBe("+inf");
    expect(formatSignal(Number.NEGATIVE_INFINITY)).toBe("-inf");
  });
});

describe("how many numbers a reading is", () => {
  it("is one when the channels agree: a mono signal is not two readings", () => {
    expect(readoutLines([0.25, 0.25])).toEqual(["+0.250"]);
  });

  it("is one per channel when they differ", () => {
    expect(readoutLines([0.25, -0.25])).toEqual(["+0.250", "-0.250"]);
  });

  it("treats a hair of difference as agreement, so a line does not flicker in and out", () => {
    expect(readoutLines([0.25, 0.25 + 1e-9])).toHaveLength(1);
  });

  it("has nothing to draw before anything is published", () => {
    expect(readoutLines([])).toEqual([]);
  });
});

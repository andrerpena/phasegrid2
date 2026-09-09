import { describe, expect, it } from "vitest";
import { METER_CEILING_DB, METER_FLOOR_DB, meterFraction } from "./MeterBlock";

/** Where a level in decibels should land on the bar, by the definition of the range. */
const at = (db: number) =>
  (db - METER_FLOOR_DB) / (METER_CEILING_DB - METER_FLOOR_DB);

describe("an amplitude as a place on the bar", () => {
  it("puts full scale near the top and half of it a sixth lower", () => {
    // The reason the scale is in decibels. Half of full scale is -6 dB, which is most of the way up;
    // on a linear bar it would be halfway, and everything quiet would be crushed against the bottom.
    expect(meterFraction(1)).toBeCloseTo(at(0), 5);
    expect(meterFraction(0.5)).toBeCloseTo(at(-6.0206), 4);
    expect(meterFraction(0.5)).toBeGreaterThan(0.8);
  });

  it("is empty for silence and for anything under the floor", () => {
    expect(meterFraction(0)).toBe(0);
    expect(meterFraction(-0)).toBe(0);
    // -60 dB is the floor itself; a hair below it is off the bottom.
    expect(meterFraction(0.001)).toBe(0);
    expect(meterFraction(0.0001)).toBe(0);
  });

  it("is full at the ceiling and stays full above it", () => {
    expect(meterFraction(2)).toBeCloseTo(1, 5); // +6 dB
    expect(meterFraction(10)).toBe(1);
  });

  it("reads a negative sample by its size: a meter has no sign", () => {
    expect(meterFraction(-0.5)).toBe(meterFraction(0.5));
  });

  it("rises with the signal all the way up", () => {
    let previous = -1;
    for (const amplitude of [0.002, 0.01, 0.1, 0.3, 0.7, 1, 1.5]) {
      const fraction = meterFraction(amplitude);
      expect(fraction).toBeGreaterThan(previous);
      previous = fraction;
    }
  });
});

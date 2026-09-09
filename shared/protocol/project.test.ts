import { describe, expect, it } from "vitest";
import { SCALE_INTERVALS, SCALE_NAMES, scaleLabel } from "./project";

describe("scales", () => {
  it("gives every named scale its intervals, in an octave, ascending from the root", () => {
    for (const name of SCALE_NAMES) {
      const intervals = SCALE_INTERVALS[name];
      expect(intervals[0], name).toBe(0);
      expect(intervals.length, name).toBeGreaterThan(0);
      expect(intervals.length, name).toBeLessThanOrEqual(12);
      for (let i = 1; i < intervals.length; i++) {
        expect(intervals[i], name).toBeGreaterThan(intervals[i - 1] ?? -1);
        expect(intervals[i], name).toBeLessThanOrEqual(11);
      }
    }
    expect(SCALE_INTERVALS.chromatic).toHaveLength(12);
    expect(SCALE_INTERVALS.major).toEqual([0, 2, 4, 5, 7, 9, 11]);
  });

  it("labels a scale the way a person names it", () => {
    expect(scaleLabel({ root: 2, name: "harmonicMinor" })).toBe(
      "D Harmonic Minor",
    );
  });
});

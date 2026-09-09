import { describe, expect, it } from "vitest";
import { resampleMinMax, triggerOffset } from "./ScopeBlock";

const sine = (count: number, cycles: number, phase = 0) =>
  Float32Array.from({ length: count }, (_, i) =>
    Math.sin(2 * Math.PI * (cycles * (i / count) + phase)),
  );

describe("triggering on a rising zero crossing", () => {
  it("finds the first rising crossing in the first half of the window", () => {
    // Four cycles of 256, starting 0.3 of a turn in: the sine falls through zero at 12.8 and rises
    // through it at 44.8, so sample 45 is the first at or above zero after one below it.
    const offset = triggerOffset(sine(256, 4, 0.3), 128);
    expect(offset).toBe(45);
  });

  it("holds a periodic signal still whatever phase the window caught it at", () => {
    // The whole reason there is a trigger: two windows of the same tone at different phases draw the
    // same picture from their respective triggers.
    const a = sine(1024, 5.5, 0.13);
    const b = sine(1024, 5.5, 0.61);
    const fromA = triggerOffset(a, 512);
    const fromB = triggerOffset(b, 512);
    // Within a sample's worth of phase: the triggers land on the sample after the crossing, which is
    // up to one sample later than the crossing itself, and a sample is 2pi/186 of a cycle here.
    for (let i = 0; i < 512; i += 7)
      expect(a[fromA + i]).toBeCloseTo(b[fromB + i], 1);
  });

  it("draws from the start when nothing crosses, or when the crossing leaves no room", () => {
    expect(
      triggerOffset(
        Float32Array.from({ length: 64 }, () => 0.7),
        32,
      ),
    ).toBe(0);
    // A crossing only in the second half: honouring it would run off the end of the window.
    const late = Float32Array.from({ length: 64 }, (_, i) => (i < 50 ? -1 : 1));
    expect(triggerOffset(late, 32)).toBe(0);
  });
});

describe("folding a span of samples into columns by their extremes", () => {
  it("keeps the least and greatest of every column", () => {
    const ramp = Float32Array.from({ length: 100 }, (_, i) => i / 100);
    const extents = resampleMinMax(ramp, 0, 100, 10);
    expect(extents).toHaveLength(10);
    expect(extents[0].min).toBe(0);
    expect(extents[0].max).toBeCloseTo(0.09);
    expect(extents[9].min).toBeCloseTo(0.9);
    expect(extents[9].max).toBeCloseTo(0.99);
  });

  it("shows noise as a band rather than as a slower wave", () => {
    // Alternating full-scale samples: nearest-sample resampling at an even stride would draw a flat
    // line at +1 or -1; the extremes say what is there, a band from -1 to 1 in every column.
    const noise = Float32Array.from({ length: 200 }, (_, i) =>
      i % 2 ? 1 : -1,
    );
    for (const e of resampleMinMax(noise, 0, 200, 20))
      expect(e).toEqual({ min: -1, max: 1 });
  });

  it("starts at the offset it is given and never reads past the end", () => {
    const samples = Float32Array.from({ length: 10 }, (_, i) => i);
    const extents = resampleMinMax(samples, 6, 8, 2);
    // Only four samples remain from 6: two per column, none of them undefined.
    expect(extents).toEqual([
      { min: 6, max: 7 },
      { min: 8, max: 9 },
    ]);
  });

  it("gives every column a value when there are more columns than samples", () => {
    const extents = resampleMinMax(Float32Array.from([0, 1]), 0, 2, 5);
    expect(extents).toHaveLength(5);
    for (const e of extents) expect(Number.isFinite(e.min)).toBe(true);
  });

  it("has nothing for an empty span", () => {
    expect(resampleMinMax([], 0, 0, 10)).toEqual([]);
    expect(resampleMinMax(Float32Array.from([1, 2]), 2, 5, 10)).toEqual([]);
  });
});

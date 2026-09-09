import { describe, expect, it } from "vitest";
import { resampleWave } from "./WaveBlock";

/** One cycle of a square of the given width, as the engine would send it. */
const pulse = (width: number, count = 512) =>
  Float32Array.from({ length: count }, (_, i) => (i / count < width ? 1 : -1));
const saw = (count = 512) =>
  Float32Array.from({ length: count }, (_, i) => (2 * i) / count - 1);
const sine = (count = 512) =>
  Float32Array.from({ length: count }, (_, i) =>
    Math.sin((2 * Math.PI * i) / count),
  );

describe("resampling a wave down to the columns a panel has", () => {
  it("keeps a square's edges vertical", () => {
    // The reason this is nearest-sample and not averaged. Every drawn point must be at one extreme or
    // the other; a single value in between is a visible ramp on what should be a step.
    //
    // 37 columns, not 40: at 40 the wave's own transition falls exactly on a column boundary, so an
    // averaging implementation never straddles it and passes this test while drawing a trapezoid
    // everywhere else. A column count that divides nothing evenly is the case that actually tests it.
    for (const v of resampleWave(pulse(0.5), 37)) expect(Math.abs(v)).toBe(1);
    for (const v of resampleWave(pulse(0.3), 37)) expect(Math.abs(v)).toBe(1);
  });

  it("spans the whole cycle, first point to last", () => {
    const points = resampleWave(saw(), 32);
    expect(points[0]).toBeCloseTo(-1, 2);
    expect(points[points.length - 1]).toBeGreaterThan(0.9);
  });

  it("draws more columns than it has samples without leaving gaps", () => {
    // A panel wider than the wave is short: every column still gets a value rather than an undefined.
    const points = resampleWave(sine(8), 50);
    expect(points).toHaveLength(50);
    for (const v of points) expect(Number.isFinite(v)).toBe(true);
  });

  it("has nothing to draw for an empty wave", () => {
    expect(resampleWave([], 10)).toEqual([]);
    expect(resampleWave(sine(), 0)).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { descriptor } from "../fixtures";
import { resampleWave } from "./SimpleWave";
import {
  pulseWave,
  sawWave,
  sineWave,
  squareWave,
  triangleWave,
  waveShape,
  waveShapeForLabel,
} from "./wave-shapes";

/** Value at a phase, for a cycle sampled evenly from 0. */
function at(wave: Float32Array, phase: number): number {
  return wave[Math.round(phase * wave.length) % wave.length];
}

describe("the basic wave shapes", () => {
  it("draws a sine that peaks a quarter of the way through", () => {
    const wave = sineWave();
    expect(at(wave, 0)).toBeCloseTo(0, 2);
    expect(at(wave, 0.25)).toBeCloseTo(1, 2);
    expect(at(wave, 0.5)).toBeCloseTo(0, 2);
    expect(at(wave, 0.75)).toBeCloseTo(-1, 2);
  });

  it("draws a triangle that peaks where the sine does", () => {
    // Aligned with the sine on purpose, so the two read as the same wave with different corners.
    const wave = triangleWave();
    expect(at(wave, 0)).toBeCloseTo(0, 2);
    expect(at(wave, 0.25)).toBeCloseTo(1, 2);
    expect(at(wave, 0.5)).toBeCloseTo(0, 2);
    expect(at(wave, 0.75)).toBeCloseTo(-1, 2);
    // Straight between the corners, which is what separates it from the sine: halfway up the rise it
    // is at exactly half, where a sine is at 0.707.
    expect(at(wave, 0.125)).toBeCloseTo(0.5, 2);
  });

  it("draws a square that is half high and half low", () => {
    const wave = squareWave();
    const high = [...wave].filter((v) => v > 0).length;
    expect(high / wave.length).toBeCloseTo(0.5, 2);
    expect(at(wave, 0.25)).toBe(1);
    expect(at(wave, 0.75)).toBe(-1);
  });

  it("draws a pulse of the width asked for", () => {
    const wave = pulseWave(0.25);
    const high = [...wave].filter((v) => v > 0).length;
    expect(high / wave.length).toBeCloseTo(0.25, 2);
    // The engine's Pulse table is a quarter wide, which is what `waveShape("pulse")` must match.
    const named = waveShape("pulse");
    expect([...named].filter((v) => v > 0).length / named.length).toBeCloseTo(
      0.25,
      2,
    );
  });

  it("draws a saw that rises across the whole cycle", () => {
    const wave = sawWave();
    expect(at(wave, 0)).toBeCloseTo(-1, 2);
    expect(at(wave, 0.5)).toBeCloseTo(0, 2);
    expect(wave[wave.length - 1]).toBeGreaterThan(0.99);
    // Monotonic: the reset edge belongs on the cycle boundary, not inside the drawing.
    for (let i = 1; i < wave.length; i++)
      expect(wave[i]).toBeGreaterThan(wave[i - 1]);
  });

  it("stays inside the range a display can draw", () => {
    for (const shape of ["sine", "triangle", "square", "saw", "pulse"] as const)
      for (const v of waveShape(shape)) {
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(1);
      }
  });
});

describe("resampling a wave down to the columns a panel has", () => {
  it("keeps a square's edges vertical", () => {
    // The reason this is nearest-sample and not averaged. Every drawn point must be at one extreme or
    // the other; a single value in between is a visible ramp on what should be a step.
    //
    // 37 columns, not 40: at 40 the wave's own transition falls exactly on a column boundary, so an
    // averaging implementation never straddles it and passes this test while drawing a trapezoid
    // everywhere else. A column count that divides nothing evenly is the case that actually tests it.
    const points = resampleWave(squareWave(), 37);
    for (const v of points) expect(Math.abs(v)).toBe(1);
    const pulse = resampleWave(pulseWave(0.3), 37);
    for (const v of pulse) expect(Math.abs(v)).toBe(1);
  });

  it("spans the whole cycle, first point to last", () => {
    const points = resampleWave(sawWave(), 32);
    expect(points[0]).toBeCloseTo(-1, 2);
    expect(points[points.length - 1]).toBeGreaterThan(0.9);
  });

  it("draws more columns than it has samples without leaving gaps", () => {
    // A panel wider than the wave is short: every column still gets a value rather than an undefined.
    const points = resampleWave(sineWave(8), 50);
    expect(points).toHaveLength(50);
    for (const v of points) expect(Number.isFinite(v)).toBe(true);
  });

  it("has nothing to draw for an empty wave", () => {
    expect(resampleWave([], 10)).toEqual([]);
    expect(resampleWave(sineWave(), 0)).toEqual([]);
  });
});

describe("the wavetables the engine actually offers", () => {
  /**
   * The join between the engine's enum labels and the curves drawn for them. It is a join by name, so
   * the failure it guards against is a table renamed on the engine side: the face would silently go
   * blank, which looks like a module with nothing to show rather than like a bug.
   */
  const labels =
    descriptor("osc.wavetable").params.find((p) => p.id === "table")
      ?.enumLabels ?? [];

  it("marks its table parameter as choosing a waveform", () => {
    const table = descriptor("osc.wavetable").params.find(
      (p) => p.id === "table",
    );
    expect(table?.uiWidget).toBe("waveSelect");
  });

  it("draws every basic shape the engine ships", () => {
    for (const name of ["Sine", "Triangle", "Square", "Pulse", "Saw"]) {
      expect(labels).toContain(name);
      expect(waveShapeForLabel(name)).not.toBeNull();
    }
  });

  it("draws nothing for a table that is not one shape", () => {
    // "Basic Shapes" morphs across four waveforms and "Saturated Sine" is not a basic shape at all.
    // Both must leave the panel empty rather than be drawn as something they are not.
    expect(waveShapeForLabel("Basic Shapes")).toBeNull();
    expect(waveShapeForLabel("Saturated Sine")).toBeNull();
  });
});

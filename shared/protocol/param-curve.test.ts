import { describe, expect, it } from "vitest";
import type { ParamCurve } from "./catalog";
import { paramFractionOf, paramValueAt } from "./param-curve";

/**
 * The taper is the engine's (`engine/src/core/Param.cpp`), ported. What matters is that the two
 * directions are inverses -- a knob drawn where a drag put it -- and that the shape is the one the
 * engine will apply to the same number.
 */

const CURVES: ParamCurve[] = ["linear", "log", "exp", "quartic"];

describe("the param taper", () => {
  it("round-trips a value through its fraction, on every curve", () => {
    for (const curve of CURVES) {
      const param = { min: curve === "log" ? 0.01 : 0, max: 8, curve };
      for (const fraction of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
        const value = paramValueAt(param, fraction);
        expect(paramFractionOf(param, value)).toBeCloseTo(fraction, 5);
      }
    }
  });

  it("puts most of a quartic knob under a tenth of its range", () => {
    // The reason the curve exists: an envelope time runs to eight seconds, and a linear knob would
    // leave everything musical in the first millimetre of the turn.
    const time = { min: 0, max: 8, curve: "quartic" as const };
    expect(paramValueAt(time, 0.5)).toBeCloseTo(0.5, 5);
    expect(paramFractionOf(time, 0.8)).toBeGreaterThan(0.55);
    // Where a linear knob would have it.
    expect(0.8 / 8).toBeLessThan(0.15);
  });

  it("clamps rather than running off either end", () => {
    const param = { min: 0, max: 8, curve: "quartic" as const };
    expect(paramValueAt(param, -1)).toBe(0);
    expect(paramValueAt(param, 2)).toBe(8);
    expect(paramFractionOf(param, -5)).toBe(0);
    expect(paramFractionOf(param, 99)).toBe(1);
  });

  it("treats a log param that reaches zero as linear rather than as infinity", () => {
    // The engine refuses to register one, so this can only be a descriptor from somewhere else. A
    // straight line is wrong; a NaN across the whole canvas is worse.
    const param = { min: 0, max: 10, curve: "log" as const };
    expect(paramValueAt(param, 0.5)).toBe(5);
    expect(paramFractionOf(param, 5)).toBe(0.5);
  });

  it("is linear when the descriptor says nothing", () => {
    expect(paramValueAt({ min: -1, max: 1 }, 0.5)).toBe(0);
    expect(paramFractionOf({ min: -1, max: 1 }, 0)).toBe(0.5);
  });
});

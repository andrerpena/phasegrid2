import { describe, expect, it } from "vitest";
import { classifyWheel } from "./wheel";

/** The four things a `wheel` event can actually be. */
function event(partial: Partial<WheelEvent>): WheelEvent {
  return {
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    ctrlKey: false,
    metaKey: false,
    ...partial,
  } as WheelEvent;
}

describe("telling wheel gestures apart", () => {
  it("reads a trackpad two-finger scroll as a pan", () => {
    // Pixel deltas, small, often on both axes at once.
    const result = classifyWheel(event({ deltaX: -6, deltaY: 12 }));
    expect(result).toEqual({ kind: "pan", dx: 6, dy: -12 });
  });

  it("reads a trackpad pinch as a proportional zoom", () => {
    // The platform reports a pinch as a wheel event with ctrlKey set and no key held.
    const inward = classifyWheel(event({ deltaY: 10, ctrlKey: true }));
    const outward = classifyWheel(event({ deltaY: -10, ctrlKey: true }));
    expect(inward.kind).toBe("zoom");
    expect(outward.kind).toBe("zoom");
    if (inward.kind !== "zoom" || outward.kind !== "zoom") return;
    expect(inward.factor).toBeLessThan(1);
    expect(outward.factor).toBeGreaterThan(1);
    // Symmetrical: pinching in and back out returns to where it started.
    expect(inward.factor * outward.factor).toBeCloseTo(1, 10);
  });

  it("reads a mouse wheel as a stepped zoom", () => {
    // Line deltas are unambiguous: no trackpad reports them.
    const up = classifyWheel(event({ deltaY: -1, deltaMode: 1 }));
    const down = classifyWheel(event({ deltaY: 1, deltaMode: 1 }));
    expect(up).toEqual({ kind: "zoom", factor: 1.1 });
    expect(down.kind).toBe("zoom");
    if (down.kind !== "zoom") return;
    expect(down.factor).toBeCloseTo(1 / 1.1, 10);
  });

  it("reads a large pixel delta as a mouse wheel too", () => {
    // Some mice report pixels, but in steps far larger than a trackpad's.
    expect(classifyWheel(event({ deltaY: -120 }))).toEqual({
      kind: "zoom",
      factor: 1.1,
    });
  });

  it("reads a held modifier as a deliberate zoom, whatever the delta", () => {
    // Command-scroll on a trackpad produces small pixel deltas, which would otherwise pan.
    expect(classifyWheel(event({ deltaY: -3, metaKey: true }))).toEqual({
      kind: "zoom",
      factor: 1.1,
    });
    expect(
      classifyWheel(event({ deltaY: -3, ctrlKey: true, metaKey: true })),
    ).toEqual({
      kind: "zoom",
      factor: 1.1,
    });
  });

  it("does nothing for a gesture with no movement in it", () => {
    expect(classifyWheel(event({}))).toEqual({ kind: "none" });
  });
});

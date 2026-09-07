import { describe, expect, it } from "vitest";
import { cableControlPoints } from "./Cable";

describe("cable shape", () => {
  it("leaves an output rightward and enters an input leftward", () => {
    // The curve is what shows the direction of flow without drawing arrowheads on every cable.
    const [c1, c2] = cableControlPoints({ x: 0, y: 0 }, { x: 300, y: 100 });
    expect(c1.x).toBeGreaterThan(0);
    expect(c2.x).toBeLessThan(300);
  });

  it("keeps the control points level with their ends", () => {
    const [c1, c2] = cableControlPoints({ x: 0, y: 10 }, { x: 200, y: 90 });
    expect(c1.y).toBe(10);
    expect(c2.y).toBe(90);
  });

  it("curves a short cable gently rather than looping it", () => {
    const [c1] = cableControlPoints({ x: 0, y: 0 }, { x: 20, y: 0 });
    expect(c1.x).toBeLessThanOrEqual(40);
  });

  it("caps the curve on a very long cable", () => {
    // Without a cap, a cable across the window swings so far that it crosses back over itself.
    const [c1] = cableControlPoints({ x: 0, y: 0 }, { x: 4000, y: 0 });
    expect(c1.x).toBeLessThanOrEqual(160);
  });

  it("makes a backwards cable loop visibly, because that is what feedback looks like", () => {
    // When the source is to the right of its destination the curve has to travel back on itself. The
    // control points still push out from each end in the direction of flow, so the cable bulges into a
    // loop rather than drawing a straight line: feedback should be visible as feedback.
    const [c1, c2] = cableControlPoints({ x: 300, y: 0 }, { x: 100, y: 0 });
    expect(c1.x).toBeGreaterThan(300);
    expect(c2.x).toBeLessThan(100);
  });
});

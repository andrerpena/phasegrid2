import { describe, expect, it } from "vitest";
import { CABLE_HEAD_LENGTH, cableControlPoints, cableShape } from "./Cable";

describe("cable shape", () => {
  it("leaves an output rightward and enters an input leftward", () => {
    // The curve shows the direction of flow before the arrowhead does.
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

  it("enters a socket at a knob's foot from below", () => {
    // A knob's modulation socket faces down. A cable that came in sideways would cross the module it
    // is plugging into; it drops in from underneath instead.
    const [, c2] = cableControlPoints(
      { x: 0, y: 0 },
      { x: 300, y: 100 },
      "down",
    );
    expect(c2.x).toBe(300);
    expect(c2.y).toBeGreaterThan(100);
  });

  it("sets off from each socket the way it faces", () => {
    // A jack placed mid-panel faces up or down as the face decided; the cable follows.
    const [c1, c2] = cableControlPoints(
      { x: 0, y: 0 },
      { x: 300, y: 100 },
      "up",
      "down",
    );
    expect(c1.x).toBe(0);
    expect(c1.y).toBeGreaterThan(0);
    expect(c2.x).toBe(300);
    expect(c2.y).toBeLessThan(100);
  });
});

describe("cable arrowhead", () => {
  it("points into a left-facing input from the left, tip on the socket's rim", () => {
    const shape = cableShape({ x: 0, y: 0 }, { x: 300, y: 100 }, "left");
    const [tip, left, right] = shape.head;
    expect(tip.x).toBeLessThan(300);
    expect(tip.x).toBeGreaterThan(300 - CABLE_HEAD_LENGTH);
    expect(tip.y).toBe(100);
    // The base is further back along the approach and spread across it.
    expect(left.x).toBe(right.x);
    expect(left.x).toBeCloseTo(tip.x - CABLE_HEAD_LENGTH);
    expect(Math.min(left.y, right.y)).toBeLessThan(100);
    expect(Math.max(left.y, right.y)).toBeGreaterThan(100);
  });

  it("stops the curve at the base of the head rather than under it", () => {
    // A stroke that ran on to the socket's centre would poke out of the head's sides.
    const shape = cableShape({ x: 0, y: 0 }, { x: 300, y: 100 }, "left");
    expect(shape.end.x).toBe(shape.head[1].x);
    expect(shape.end.y).toBe(100);
  });

  it("points up into a socket at a knob's foot", () => {
    const shape = cableShape({ x: 0, y: 0 }, { x: 300, y: 100 }, "down");
    const [tip, left, right] = shape.head;
    expect(tip.x).toBe(300);
    expect(tip.y).toBeGreaterThan(100);
    expect(left.y).toBe(right.y);
    expect(left.y).toBeGreaterThan(tip.y);
    expect(left.x).not.toBe(right.x);
  });

  it("wears the head right on a loose end being dragged", () => {
    // Nothing to stop short of: the tip is the pointer.
    const shape = cableShape(
      { x: 0, y: 0 },
      { x: 300, y: 100 },
      "left",
      "right",
      0,
    );
    expect(shape.head[0]).toEqual({ x: 300, y: 100 });
  });
});

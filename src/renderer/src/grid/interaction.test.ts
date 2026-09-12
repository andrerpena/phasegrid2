import { describe, expect, it } from "vitest";
import {
  beginDragCable,
  beginDragNodes,
  beginMarquee,
  beginPan,
  canConnect,
  IDLE,
  orientEdge,
  pointerMove,
  pointerUp,
} from "./interaction";

const at = (x: number, y: number) => ({ x, y });

describe("pointer interaction", () => {
  it("pans by the distance travelled", () => {
    const start = beginPan(at(10, 10));
    const moved = pointerMove(start, at(15, 20));
    expect(moved.pan).toEqual({ x: 5, y: 10 });
  });

  it("does not treat a jittery click as a drag", () => {
    // A press that wobbles by a pixel must not move a node and must not leave an undo entry behind.
    let state = beginDragNodes(["a"], at(0, 0));
    state = pointerMove(state, at(1, 1)).next;
    expect(pointerUp(state, at(1, 1)).committedMove).toBeUndefined();
  });

  it("commits a drag that actually travelled", () => {
    let state = beginDragNodes(["a", "b"], at(0, 0));
    state = pointerMove(state, at(40, 20)).next;
    const end = pointerUp(state, at(40, 20));
    expect(end.committedMove).toEqual({
      ids: ["a", "b"],
      from: at(0, 0),
      to: at(40, 20),
    });
  });

  it("reports each move's delta rather than the total", () => {
    // The caller moves nodes by the delta each time; reporting the total would move them further on
    // every event and send them off the canvas.
    let state = beginDragNodes(["a"], at(0, 0));
    const first = pointerMove(state, at(10, 0));
    expect(first.delta).toEqual({ x: 10, y: 0 });
    state = first.next;
    expect(pointerMove(state, at(15, 0)).delta).toEqual({ x: 5, y: 0 });
  });

  it("gives a marquee rectangle whichever way it was dragged", () => {
    let state = beginMarquee(at(50, 50), false);
    state = pointerMove(state, at(10, 20)).next;
    expect(pointerUp(state, at(10, 20)).marquee?.rect).toEqual({
      x: 10,
      y: 20,
      width: 40,
      height: 30,
    });
  });

  it("remembers whether a marquee was meant to add to the selection", () => {
    const state = beginMarquee(at(0, 0), true);
    expect(pointerUp(state, at(5, 5)).marquee?.additive).toBe(true);
  });

  it("reports where a cable was released", () => {
    const from = { module: "osc", port: "out" };
    let state = beginDragCable(from, "output", at(0, 0));
    state = pointerMove(state, at(30, 30)).next;
    expect(pointerUp(state, at(30, 30)).cableDrop).toEqual({
      from,
      fromSide: "output",
      at: at(30, 30),
    });
  });

  it("carries the cable it picked up through to the drop", () => {
    // A cable pulled off a connected input is the edge it was, until it lands somewhere else or on
    // nothing. Whoever handles the drop has to know which edge that was.
    const from = { module: "osc", port: "out" };
    const state = beginDragCable(from, "output", at(0, 0), "e7");
    expect(pointerUp(state, at(30, 30)).cableDrop?.detach).toBe("e7");
    expect(
      pointerUp(beginDragCable(from, "output", at(0, 0)), at(1, 1)).cableDrop
        ?.detach,
    ).toBeUndefined();
  });

  it("returns to idle after every gesture", () => {
    expect(pointerUp(beginPan(at(0, 0)), at(0, 0)).next).toEqual(IDLE);
    expect(pointerUp(beginMarquee(at(0, 0), false), at(1, 1)).next).toEqual(
      IDLE,
    );
  });

  it("ignores movement while idle", () => {
    expect(pointerMove(IDLE, at(5, 5)).next).toEqual(IDLE);
  });
});

describe("deciding whether a cable can be made", () => {
  const osc = { module: "osc", port: "out" };
  const vca = { module: "vca", port: "in" };

  it("joins an output to an input", () => {
    expect(canConnect("output", "input", osc, vca)).toBe(true);
  });

  it("refuses two ends of the same kind", () => {
    expect(
      canConnect("output", "output", osc, { module: "vca", port: "out" }),
    ).toBe(false);
    expect(
      canConnect("input", "input", vca, { module: "osc", port: "in" }),
    ).toBe(false);
  });

  it("refuses a module plugged into itself", () => {
    // The compiler would reject it as a cycle; refusing at the gesture says so while the pointer is
    // still down rather than as an error afterwards.
    expect(
      canConnect("output", "input", osc, { module: "osc", port: "in" }),
    ).toBe(false);
  });

  it("orients an edge the same way whichever direction it was drawn", () => {
    expect(orientEdge(osc, "output", vca)).toEqual({ from: osc, to: vca });
    expect(orientEdge(vca, "input", osc)).toEqual({ from: osc, to: vca });
  });
});

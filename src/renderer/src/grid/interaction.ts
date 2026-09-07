import type { PortRef } from "@shared/protocol/patch";
import type { Point } from "./layout";

/**
 * What the pointer is doing, as an explicit state machine.
 *
 * Written as data and pure transitions so it can be tested without a canvas, and so the answer to
 * "why did dragging do that" is one place rather than scattered through event handlers. The states are
 * mutually exclusive on purpose: a drag that is both moving nodes and drawing a marquee is the bug
 * this shape prevents.
 */

export type Interaction =
  | { kind: "idle" }
  | { kind: "panning"; last: Point }
  | {
      kind: "dragNodes";
      ids: string[];
      start: Point;
      last: Point;
      moved: boolean;
    }
  | { kind: "marquee"; start: Point; current: Point; additive: boolean }
  | {
      kind: "dragCable";
      from: PortRef;
      fromSide: "input" | "output";
      current: Point;
    };

export const IDLE: Interaction = { kind: "idle" };

/** How far the pointer must move before a press becomes a drag, in patch units. */
export const DRAG_THRESHOLD = 3;

export function beginPan(at: Point): Interaction {
  return { kind: "panning", last: at };
}

export function beginDragNodes(ids: string[], at: Point): Interaction {
  return { kind: "dragNodes", ids, start: at, last: at, moved: false };
}

export function beginMarquee(at: Point, additive: boolean): Interaction {
  return { kind: "marquee", start: at, current: at, additive };
}

export function beginDragCable(
  from: PortRef,
  fromSide: "input" | "output",
  at: Point,
): Interaction {
  return { kind: "dragCable", from, fromSide, current: at };
}

export interface MoveResult {
  next: Interaction;
  /** How far to move the dragged nodes, in patch units. Zero unless dragging nodes. */
  delta?: Point;
  /** How far to pan. Zero unless panning. */
  pan?: Point;
}

export function pointerMove(state: Interaction, at: Point): MoveResult {
  switch (state.kind) {
    case "panning":
      return {
        next: { ...state, last: at },
        pan: { x: at.x - state.last.x, y: at.y - state.last.y },
      };
    case "dragNodes": {
      const delta = { x: at.x - state.last.x, y: at.y - state.last.y };
      // A press that has not travelled far enough is not yet a drag, so a click that jitters by a pixel
      // does not become a move nobody asked for and an undo entry nobody wants.
      const travelled =
        Math.abs(at.x - state.start.x) > DRAG_THRESHOLD ||
        Math.abs(at.y - state.start.y) > DRAG_THRESHOLD;
      return {
        next: { ...state, last: at, moved: state.moved || travelled },
        delta,
      };
    }
    case "marquee":
      return { next: { ...state, current: at } };
    case "dragCable":
      return { next: { ...state, current: at } };
    case "idle":
      return { next: state };
  }
}

export interface EndResult {
  next: Interaction;
  /** True when a node drag actually moved something, so only then is it worth recording. */
  committedMove?: { ids: string[]; from: Point; to: Point };
  /** The rectangle a marquee covered, in patch units. */
  marquee?: {
    rect: { x: number; y: number; width: number; height: number };
    additive: boolean;
  };
  /** Where a cable was released, for the caller to hit test. */
  cableDrop?: { from: PortRef; fromSide: "input" | "output"; at: Point };
}

export function pointerUp(state: Interaction, at: Point): EndResult {
  switch (state.kind) {
    case "dragNodes":
      return {
        next: IDLE,
        ...(state.moved
          ? {
              committedMove: {
                ids: state.ids,
                from: state.start,
                to: state.last,
              },
            }
          : {}),
      };
    case "marquee":
      return {
        next: IDLE,
        marquee: {
          rect: {
            x: Math.min(state.start.x, state.current.x),
            y: Math.min(state.start.y, state.current.y),
            width: Math.abs(state.start.x - state.current.x),
            height: Math.abs(state.start.y - state.current.y),
          },
          additive: state.additive,
        },
      };
    case "dragCable":
      return {
        next: IDLE,
        cableDrop: { from: state.from, fromSide: state.fromSide, at },
      };
    case "panning":
    case "idle":
      return { next: IDLE };
  }
}

/**
 * Whether a cable between these two ends is worth making.
 *
 * One end has to be an output and the other an input, and they cannot be the same module: a node
 * plugged into itself is a feedback loop the compiler will reject, and refusing it here says so at the
 * moment of the gesture rather than as an error afterwards.
 */
export function canConnect(
  fromSide: "input" | "output",
  toSide: "input" | "output",
  from: PortRef,
  to: PortRef,
): boolean {
  if (fromSide === toSide) return false;
  return from.module !== to.module;
}

/** Puts the two ends the right way round, whichever direction the cable was drawn in. */
export function orientEdge(
  a: PortRef,
  aSide: "input" | "output",
  b: PortRef,
): { from: PortRef; to: PortRef } {
  return aSide === "output" ? { from: a, to: b } : { from: b, to: a };
}

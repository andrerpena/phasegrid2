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
  | {
      kind: "dragParam";
      module: string;
      param: string;
      /** Where the pointer went down, in screen pixels: a knob drag is measured in pixels, not patch
       * units, so it feels the same at every zoom. */
      startY: number;
      /** The value when the drag began, as a fraction of the parameter's range. */
      startFraction: number;
      fraction: number;
    }
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
      /**
       * The edge this cable was, when it was picked up off a connected input rather than started
       * fresh. Dropping it on nothing removes that edge; dropping it on another input moves it.
       */
      detach?: string;
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
  detach?: string,
): Interaction {
  return {
    kind: "dragCable",
    from,
    fromSide,
    current: at,
    ...(detach === undefined ? {} : { detach }),
  };
}

/** How far the pointer travels, in screen pixels, to sweep a knob's whole range. */
export const KNOB_DRAG_RANGE = 180;
/** With a modifier held. Slow enough to set a filter cutoff by ear rather than by luck. */
export const KNOB_FINE_RANGE = 900;

/** A fraction of a parameter's range as the number the parameter actually takes. */
export function paramValueAt(
  param: { min: number; max: number },
  fraction: number,
): number {
  return param.min + fraction * (param.max - param.min);
}

export function beginDragParam(
  module: string,
  param: string,
  startY: number,
  startFraction: number,
): Interaction {
  return {
    kind: "dragParam",
    module,
    param,
    startY,
    startFraction,
    fraction: startFraction,
  };
}

/**
 * Where a knob drag has got to.
 *
 * Upward increases, which is the convention every plug-in uses, and the travel is measured in screen
 * pixels rather than patch units so a knob feels identical whether the patch is zoomed in or out. The
 * fine modifier stretches the same gesture over five times the distance.
 */
export function dragParamTo(
  state: Extract<Interaction, { kind: "dragParam" }>,
  y: number,
  fine: boolean,
): Extract<Interaction, { kind: "dragParam" }> {
  const range = fine ? KNOB_FINE_RANGE : KNOB_DRAG_RANGE;
  const moved = (state.startY - y) / range;
  return {
    ...state,
    fraction: Math.min(1, Math.max(0, state.startFraction + moved)),
  };
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
    case "dragParam":
      // Knob drags are driven by screen position, which `pointerMove` does not carry; the caller uses
      // `dragParamTo` instead. Handled here only so the state machine stays exhaustive.
      return { next: state };
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
  /** Where a cable was released, for the caller to hit test, and the edge it was if picked up. */
  cableDrop?: {
    from: PortRef;
    fromSide: "input" | "output";
    at: Point;
    detach?: string;
  };
  /**
   * A finished knob drag: the point at which it becomes one undo entry rather than a hundred.
   *
   * `startFraction` is where the knob was when the hand went down. The document has been rewritten on
   * every frame since, so it no longer remembers, and undo would otherwise step back to the last
   * frame of the drag rather than to before it.
   */
  committedParam?: {
    module: string;
    param: string;
    fraction: number;
    startFraction: number;
  };
}

export function pointerUp(state: Interaction, at: Point): EndResult {
  switch (state.kind) {
    case "dragParam":
      return {
        next: IDLE,
        committedParam: {
          module: state.module,
          param: state.param,
          fraction: state.fraction,
          startFraction: state.startFraction,
        },
      };
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
        cableDrop: {
          from: state.from,
          fromSide: state.fromSide,
          at,
          ...(state.detach === undefined ? {} : { detach: state.detach }),
        },
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

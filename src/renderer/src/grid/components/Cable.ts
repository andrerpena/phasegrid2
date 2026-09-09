import { Graphics } from "pixi.js";
import type { Facing } from "../face";
import { PORT_RADIUS, type Point } from "../layout";

/**
 * A cable between two sockets.
 *
 * Drawn as a cubic curve that sets off from each socket the way that socket faces, so the direction
 * of signal flow is visible in the shape alone: out of an output to the right, into an input from the
 * left, and down out of a knob's foot for the socket that sits there. Control points scaled by the
 * distance are what make a short cable curve gently and a long one swing wide instead of both looking
 * like the same rubber band. The curve ends in an arrowhead pointing into the input socket, so the
 * direction of a cable is readable at either end even when its shape is ambiguous, which a feedback
 * loop or a cable between two modules side by side is.
 *
 * Coloured by the source port's role, so a cable and the socket it leaves are always the same colour
 * and you can follow a signal across a patch by colour alone.
 */

/** How far the arrowhead reaches back from its tip along the cable. */
export const CABLE_HEAD_LENGTH = 7;
/** Half the width of the arrowhead at its base. */
const CABLE_HEAD_HALF_WIDTH = 3.5;

/** A point `reach` away from `at`, in the direction a socket faces. */
function away(at: Point, facing: Facing, reach: number): Point {
  switch (facing) {
    case "left":
      return { x: at.x - reach, y: at.y };
    case "right":
      return { x: at.x + reach, y: at.y };
    case "up":
      return { x: at.x, y: at.y - reach };
    case "down":
      return { x: at.x, y: at.y + reach };
  }
}

/**
 * `fromFacing` and `toFacing` are the ways the two sockets face. An output usually faces right and
 * an input left; a knob's modulation socket faces down, so a cable into it drops in from below
 * rather than crossing the module it is plugging into.
 */
export function cableControlPoints(
  from: Point,
  to: Point,
  toFacing: Facing = "left",
  fromFacing: Facing = "right",
): [Point, Point] {
  // Enough curve to be readable, capped so a cable across the window does not loop back on itself.
  const reach = Math.min(160, Math.max(40, Math.abs(to.x - from.x) * 0.6));
  return [away(from, fromFacing, reach), away(to, toFacing, reach)];
}

/** The whole of a cable: its curve, which stops at the base of the head, and the head itself. */
export interface CableShape {
  start: Point;
  c1: Point;
  c2: Point;
  /** Where the stroke stops: the base of the arrowhead. */
  end: Point;
  /** The arrowhead, tip first, then its two base corners. */
  head: [Point, Point, Point];
}

/**
 * The geometry of a cable from `from` to the socket at `to`.
 *
 * The arrowhead's tip rests on the socket's rim rather than at its centre, so it is seen pointing at
 * the socket instead of being hidden under it, and the curve stops at the base of the head so the
 * stroke does not poke out of the head's sides. `socketRadius` is the ring the tip stops short of;
 * zero for a loose end being dragged, which then wears its head right on the pointer.
 */
export function cableShape(
  from: Point,
  to: Point,
  toFacing: Facing = "left",
  fromFacing: Facing = "right",
  socketRadius: number = PORT_RADIUS + 1,
): CableShape {
  const [c1, c2] = cableControlPoints(from, to, toFacing, fromFacing);
  // The cable arrives along the axis the socket faces, so the head lies on that axis, pointing
  // against the facing: into a left-facing input from the left.
  const tip = away(to, toFacing, socketRadius);
  const base = away(to, toFacing, socketRadius + CABLE_HEAD_LENGTH);
  const across = toFacing === "left" || toFacing === "right" ? "down" : "right";
  return {
    start: from,
    c1,
    c2,
    end: base,
    head: [
      tip,
      away(base, across, CABLE_HEAD_HALF_WIDTH),
      away(base, across, -CABLE_HEAD_HALF_WIDTH),
    ],
  };
}

/** Draws `shape` into `g`, after `map` has taken each point wherever the graphics lives. */
export function drawCableShape(
  g: Graphics,
  shape: CableShape,
  stroke: { width: number; color: number; alpha: number },
  map: (p: Point) => Point = (p) => p,
): void {
  const start = map(shape.start);
  const c1 = map(shape.c1);
  const c2 = map(shape.c2);
  const end = map(shape.end);
  const [tip, left, right] = shape.head.map(map);
  g.moveTo(start.x, start.y)
    .bezierCurveTo(c1.x, c1.y, c2.x, c2.y, end.x, end.y)
    .stroke({ ...stroke, cap: "round" })
    .poly([tip.x, tip.y, left.x, left.y, right.x, right.y], true)
    .fill({ color: stroke.color, alpha: stroke.alpha });
}

export class Cable {
  readonly view = new Graphics();

  constructor(private color: number) {}

  update(
    from: Point,
    to: Point,
    options: {
      selected?: boolean;
      dimmed?: boolean;
      toFacing?: Facing;
      fromFacing?: Facing;
    } = {},
  ): void {
    this.view.clear();
    drawCableShape(
      this.view,
      cableShape(from, to, options.toFacing, options.fromFacing),
      {
        width: options.selected ? 3 : 2,
        color: this.color,
        alpha: options.dimmed ? 0.35 : 1,
      },
    );
  }

  setColor(color: number): void {
    this.color = color;
  }

  destroy(): void {
    this.view.destroy();
  }
}

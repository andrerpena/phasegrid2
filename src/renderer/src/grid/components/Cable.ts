import { Graphics } from "pixi.js";
import type { Facing } from "../face";
import type { Point } from "../layout";

/**
 * A cable between two sockets.
 *
 * Drawn as a cubic curve that sets off from each socket the way that socket faces, so the direction
 * of signal flow is visible without arrowheads: out of an output to the right, into an input from the
 * left, and down out of a knob's foot for the socket that sits there. Control points scaled by the
 * distance are what make a short cable curve gently and a long one swing wide instead of both looking
 * like the same rubber band.
 *
 * Coloured by the source port's role, so a cable and the socket it leaves are always the same colour
 * and you can follow a signal across a patch by colour alone.
 */

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
    const [c1, c2] = cableControlPoints(
      from,
      to,
      options.toFacing,
      options.fromFacing,
    );
    this.view
      .clear()
      .moveTo(from.x, from.y)
      .bezierCurveTo(c1.x, c1.y, c2.x, c2.y, to.x, to.y)
      .stroke({
        width: options.selected ? 3 : 2,
        color: this.color,
        alpha: options.dimmed ? 0.35 : 1,
        cap: "round",
      });
  }

  setColor(color: number): void {
    this.color = color;
  }

  destroy(): void {
    this.view.destroy();
  }
}

import { Graphics } from "pixi.js";
import type { Point } from "../layout";

/**
 * A cable between two ports.
 *
 * Drawn as a cubic curve that leaves an output to the right and enters an input from the left, so the
 * direction of signal flow is visible without arrowheads. Horizontal control points, scaled by the
 * distance, are what make a short cable curve gently and a long one swing wide instead of both looking
 * like the same rubber band.
 *
 * Coloured by the source port's role, so a cable and the socket it leaves are always the same colour
 * and you can follow a signal across a patch by colour alone.
 */

export function cableControlPoints(from: Point, to: Point): [Point, Point] {
  // Enough curve to be readable, capped so a cable across the window does not loop back on itself.
  const reach = Math.min(160, Math.max(40, Math.abs(to.x - from.x) * 0.6));
  return [
    { x: from.x + reach, y: from.y },
    { x: to.x - reach, y: to.y },
  ];
}

export class Cable {
  readonly view = new Graphics();

  constructor(private color: number) {}

  update(
    from: Point,
    to: Point,
    options: { selected?: boolean; dimmed?: boolean } = {},
  ): void {
    const [c1, c2] = cableControlPoints(from, to);
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

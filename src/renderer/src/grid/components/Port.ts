import { Container, Graphics } from "pixi.js";

/**
 * A port socket: a ring in the colour of what it carries.
 *
 * Colour comes from the port's signal role, which comes from the engine's own descriptor. A module
 * added to the engine therefore draws its ports correctly with no change here, and the colour a cable
 * is drawn in always matches the socket it leaves.
 *
 * Hollow when nothing is plugged in, filled when something is. That distinction is worth more than it
 * looks: it is how you read at a glance which inputs of a patch are actually driven.
 */
export class Port {
  readonly view = new Container();
  private readonly ring = new Graphics();
  private state = { connected: false, hovered: false, color: 0 };

  constructor(
    private readonly radius: number,
    color: number,
  ) {
    this.view.addChild(this.ring);
    this.state.color = color;
    this.draw();
  }

  update(next: {
    connected?: boolean;
    hovered?: boolean;
    color?: number;
  }): void {
    const merged = { ...this.state, ...next };
    if (
      merged.connected === this.state.connected &&
      merged.hovered === this.state.hovered &&
      merged.color === this.state.color
    )
      return;
    this.state = merged;
    this.draw();
  }

  private draw(): void {
    const { connected, hovered, color } = this.state;
    const r = this.radius * (hovered ? 1.35 : 1);
    this.ring.clear().circle(0, 0, r);
    if (connected) this.ring.fill({ color });
    else this.ring.fill({ color: 0x000000, alpha: 0.55 });
    this.ring.stroke({ width: hovered ? 2 : 1.5, color });
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}

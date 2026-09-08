import { Container } from "pixi.js";
import type { ControlLayout } from "../layout";
import { KNOB_CELL_WIDTH } from "../layout";
import { Knob, type KnobStyle } from "./Knob";

/**
 * A row of knobs, one per control the layout gives it.
 *
 * This is the whole of a module's face for most modules, and the right-hand part of it for one that
 * also shows a wave. It takes geometry and a style and nothing else, so a story can show a face with
 * any number of knobs from a fixture, and a module that grows a knob changes its descriptor, not this.
 *
 * Two values per knob, kept apart on purpose. `setValue` is the document's number, the one a drag
 * edits; `setLive` is where modulation has put it this frame, or null when nothing is plugged in.
 * The document redraws the first when it changes; telemetry drives the second at frame rate.
 */
export class KnobRow {
  readonly view = new Container();
  private readonly knobs = new Map<string, Knob>();

  constructor(controls: readonly ControlLayout[], style: KnobStyle) {
    for (const control of controls) {
      const knob = new Knob(
        control.radius,
        control.param.name,
        style,
        KNOB_CELL_WIDTH - 4,
      );
      knob.view.position.set(control.x, control.y);
      this.knobs.set(control.param.id, knob);
      this.view.addChild(knob.view);
    }
  }

  /** The knobs this row holds, by param id. */
  has(paramId: string): boolean {
    return this.knobs.has(paramId);
  }

  setValue(paramId: string, fraction: number): void {
    this.knobs.get(paramId)?.update(fraction);
  }

  setLive(paramId: string, fraction: number | null): void {
    this.knobs.get(paramId)?.setLive(fraction);
  }

  setStyle(style: KnobStyle): void {
    for (const knob of this.knobs.values()) knob.setStyle(style);
  }

  destroy(): void {
    for (const knob of this.knobs.values()) knob.destroy();
    this.view.destroy({ children: true });
  }
}

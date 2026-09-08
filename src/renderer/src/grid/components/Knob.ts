import { Container, Graphics, Text } from "pixi.js";

/**
 * A knob with a value arc and a label, drawn the way a hardware panel draws one.
 *
 * The arc is the point: it says where the value sits in its range at a glance, from across the window,
 * without reading a number. The pointer is the fine detail you look at once you are already there.
 *
 * A class with an `update` rather than a function returning a display object, because a patch redraws
 * on every parameter change and rebuilding graphics sixty times a second is how a canvas starts
 * dropping frames. Built once, updated in place, destroyed when its node goes.
 */

export interface KnobStyle {
  /** Where the arc is drawn: the module's accent, so a node reads as one thing. */
  arc: number;
  track: number;
  body: number;
  pointer: number;
  label: number;
}

/** Three quarters of a turn, the gap at the bottom, as every physical knob has. */
const START_ANGLE = Math.PI * 0.75;
const SWEEP = Math.PI * 1.5;

/** Cuts a label down until it fits, ending in an ellipsis so it reads as shortened rather than wrong. */
function trimToWidth(text: string, width: number, probe: Text): string {
  let candidate = text;
  while (candidate.length > 1) {
    candidate = candidate.slice(0, -1);
    probe.text = `${candidate}...`;
    if (probe.width <= width) return `${candidate}...`;
  }
  return candidate;
}

export class Knob {
  readonly view = new Container();
  private readonly track = new Graphics();
  private readonly arc = new Graphics();
  private readonly notch = new Graphics();
  private readonly body = new Graphics();
  private readonly pointer = new Graphics();
  private readonly label: Text;
  /** The value the document holds: what a drag edits and, with nothing modulating, what is drawn. */
  private fraction = -1;
  /**
   * Where modulation has put the value right now, or null when nothing is plugged in. Drawn as the
   * pointer and the arc, so the knob visibly turns; `fraction` then shows as a notch on the track.
   */
  private live: number | null = null;

  constructor(
    private readonly radius: number,
    labelText: string,
    private style: KnobStyle,
    /** Room the label has. Past it the text is trimmed rather than colliding with its neighbour. */
    labelWidth = radius * 2.8,
  ) {
    this.label = new Text({
      text: labelText,
      style: {
        fontSize: 9,
        fill: style.label,
        fontFamily: "system-ui, sans-serif",
      },
    });
    // Labels come from the engine's descriptors and some are long ("Comb Blend Offset"). Left alone
    // they run into the label beside them and a row of knobs becomes one unreadable string.
    if (this.label.width > labelWidth)
      this.label.text = trimToWidth(labelText, labelWidth, this.label);
    this.label.anchor.set(0.5, 0);
    this.label.position.set(0, radius + 5);
    this.view.addChild(
      this.track,
      this.arc,
      this.notch,
      this.body,
      this.pointer,
      this.label,
    );
    this.drawStatic();
  }

  /** The unchanging parts, drawn once. */
  private drawStatic(): void {
    const r = this.radius;
    this.track
      .clear()
      .arc(0, 0, r + 3, START_ANGLE, START_ANGLE + SWEEP)
      .stroke({
        width: 2.5,
        color: this.style.track,
        alpha: 0.9,
        cap: "round",
      });
    this.body
      .clear()
      .circle(0, 0, r)
      .fill({ color: this.style.body })
      // A rim rather than a flat disc: it separates the knob from the arc behind it at small sizes,
      // where a circle and the arc around it otherwise merge into one blob.
      .stroke({ width: 1, color: 0x000000, alpha: 0.45 });
  }

  /** `fraction` is 0 to 1 across the parameter's range: the document's value. */
  update(fraction: number): void {
    if (Math.abs(fraction - this.fraction) < 0.001) return;
    this.fraction = fraction;
    this.draw();
  }

  /**
   * The value modulation has produced this frame, 0 to 1, or null once nothing is plugged in.
   *
   * Called at frame rate while a cable feeds the knob, so it does the same "only redraw on a change"
   * as `update`: a slow LFO holds still for many frames, and redrawing geometry for them costs the
   * canvas frames for nothing.
   */
  setLive(fraction: number | null): void {
    if (
      fraction === null
        ? this.live === null
        : this.live !== null && Math.abs(fraction - this.live) < 0.001
    )
      return;
    this.live = fraction;
    this.draw();
  }

  private draw(): void {
    const r = this.radius;
    const base = Math.max(0, this.fraction);
    const shown = this.live ?? base;
    const angle = START_ANGLE + SWEEP * shown;

    this.arc.clear();
    // A zero-length arc still draws a round cap, which reads as a value that is not zero. Skip it.
    if (shown > 0.001) {
      this.arc
        .arc(0, 0, r + 3, START_ANGLE, angle)
        .stroke({ width: 2.5, color: this.style.arc, cap: "round" });
    }

    // With modulation moving the pointer, the value the knob is set to still has to be readable: it
    // is what a drag changes and what undo returns to. A short tick across the track marks it.
    this.notch.clear();
    if (this.live !== null) {
      const at = START_ANGLE + SWEEP * base;
      this.notch
        .moveTo(Math.cos(at) * (r + 0.5), Math.sin(at) * (r + 0.5))
        .lineTo(Math.cos(at) * (r + 5.5), Math.sin(at) * (r + 5.5))
        .stroke({ width: 2, color: this.style.label, cap: "butt" });
    }

    this.pointer
      .clear()
      .moveTo(Math.cos(angle) * (r * 0.35), Math.sin(angle) * (r * 0.35))
      .lineTo(Math.cos(angle) * (r * 0.85), Math.sin(angle) * (r * 0.85))
      .stroke({ width: 2, color: this.style.pointer, cap: "round" });
  }

  setStyle(style: KnobStyle): void {
    this.style = style;
    this.label.style.fill = style.label;
    this.drawStatic();
    this.draw();
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}

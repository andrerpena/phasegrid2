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
  private readonly body = new Graphics();
  private readonly pointer = new Graphics();
  private readonly label: Text;
  private fraction = -1;

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

  /** `fraction` is 0 to 1 across the parameter's range. */
  update(fraction: number): void {
    if (Math.abs(fraction - this.fraction) < 0.001) return;
    this.fraction = fraction;
    const r = this.radius;
    const angle = START_ANGLE + SWEEP * fraction;

    this.arc.clear();
    // A zero-length arc still draws a round cap, which reads as a value that is not zero. Skip it.
    if (fraction > 0.001) {
      this.arc
        .arc(0, 0, r + 3, START_ANGLE, angle)
        .stroke({ width: 2.5, color: this.style.arc, cap: "round" });
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
    const previous = this.fraction;
    this.fraction = -1;
    this.update(previous < 0 ? 0 : previous);
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}

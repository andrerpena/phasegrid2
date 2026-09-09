import { Container, Graphics, Text } from "pixi.js";
import type { KnobBlock as KnobGeometry } from "../../face";
import { PORT_RADIUS } from "../../layout";
import {
  type Block,
  type BlockStyle,
  drawSocket,
  drawTile,
  type KnobStyle,
  type SocketState,
} from "./Block";

/**
 * A knob with a value arc, a label under it, and, when the parameter can be modulated, the socket
 * for its modulation at its foot.
 *
 * The arc is the point: it says where the value sits in its range at a glance, from across the
 * window, without reading a number. The pointer is the fine detail you look at once you are already
 * there.
 *
 * Two values, kept apart on purpose. `setValue` is the document's number, the one a drag edits;
 * `setLive` is where modulation has put it this frame, or null when nothing is plugged in. The
 * document redraws the first when it changes; telemetry drives the second at frame rate. Both only
 * redraw on a change: a slow LFO holds still for many frames, and redrawing geometry for them costs
 * the canvas frames for nothing.
 */

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

export class KnobBlock implements Block {
  readonly view = new Container();
  private readonly tile = new Graphics();
  private readonly track = new Graphics();
  private readonly arc = new Graphics();
  private readonly notch = new Graphics();
  private readonly body = new Graphics();
  private readonly pointer = new Graphics();
  private readonly label: Text;
  /** The modulation socket, or null when the parameter cannot be modulated. */
  private readonly socket: Graphics | null;
  private socketState: SocketState = { connected: false, hovered: false };
  private style: BlockStyle;
  /** The value the document holds: what a drag edits and, with nothing modulating, what is drawn. */
  private fraction = -1;
  /**
   * Where modulation has put the value right now, or null when nothing is plugged in. Drawn as the
   * pointer and the arc, so the knob visibly turns; `fraction` then shows as a notch on the track.
   */
  private live: number | null = null;

  /** Where modulation has the knob this frame, 0 to 1, or null with nothing plugged in. */
  get liveFraction(): number | null {
    return this.live;
  }

  constructor(
    readonly geometry: KnobGeometry,
    style: BlockStyle,
  ) {
    this.style = style;
    this.view.position.set(geometry.x, geometry.y);
    const centre = {
      x: geometry.centre.x - geometry.x,
      y: geometry.centre.y - geometry.y,
    };
    for (const g of [this.track, this.arc, this.notch, this.body, this.pointer])
      g.position.set(centre.x, centre.y);

    this.label = new Text({
      text: geometry.param.name,
      style: {
        fontSize: 8,
        fill: style.knob.label,
        fontFamily: "system-ui, sans-serif",
      },
    });
    // Labels come from the engine's descriptors and some are long ("Comb Blend Offset"). Left alone
    // they run into the label beside them and a row of knobs becomes one unreadable string.
    // Centred on the knob, which sits left of the tile's middle; the socket has the corner on the right.
    const labelWidth = (geometry.centre.x - geometry.x) * 2 - 4;
    if (this.label.width > labelWidth)
      this.label.text = trimToWidth(
        geometry.param.name,
        labelWidth,
        this.label,
      );
    this.label.anchor.set(0.5, 1);
    this.label.position.set(centre.x, geometry.labelY - geometry.y);

    this.view.addChild(
      this.tile,
      this.track,
      this.arc,
      this.notch,
      this.body,
      this.pointer,
      this.label,
    );

    if (geometry.socket === null) {
      this.socket = null;
    } else {
      this.socket = new Graphics();
      this.socket.position.set(
        geometry.socket.x - geometry.x,
        geometry.socket.y - geometry.y,
      );
      this.view.addChild(this.socket);
    }
    this.drawStatic();
    this.drawSocket();
  }

  private get knobStyle(): KnobStyle {
    return this.style.knob;
  }

  /** The unchanging parts, drawn once. */
  private drawStatic(): void {
    const r = this.geometry.radius;
    drawTile(this.tile, this.geometry, this.style.tile);
    this.track
      .clear()
      .arc(0, 0, r + 3, START_ANGLE, START_ANGLE + SWEEP)
      .stroke({
        width: 2.5,
        color: this.knobStyle.track,
        alpha: 0.9,
        cap: "round",
      });
    this.body
      .clear()
      .circle(0, 0, r)
      .fill({ color: this.knobStyle.body })
      // A rim rather than a flat disc: it separates the knob from the arc behind it at small sizes,
      // where a circle and the arc around it otherwise merge into one blob.
      .stroke({ width: 1, color: 0x000000, alpha: 0.45 });
  }

  private drawSocket(): void {
    if (this.socket === null || this.geometry.socket === null) return;
    const color =
      this.style.signal[this.geometry.socket.port.role] ??
      this.style.signal.any;
    drawSocket(this.socket, PORT_RADIUS, color, this.socketState);
  }

  /** `fraction` is 0 to 1 across the parameter's range: the document's value. */
  setValue(fraction: number): void {
    if (Math.abs(fraction - this.fraction) < 0.001) return;
    this.fraction = fraction;
    this.draw();
  }

  /** The value modulation has produced this frame, 0 to 1, or null once nothing is plugged in. */
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

  /** The modulation socket's state. Ignored on a knob that has none. */
  update(next: Partial<SocketState>): void {
    const merged = { ...this.socketState, ...next };
    if (
      merged.connected === this.socketState.connected &&
      merged.hovered === this.socketState.hovered
    )
      return;
    this.socketState = merged;
    this.drawSocket();
  }

  private draw(): void {
    const r = this.geometry.radius;
    const base = Math.max(0, this.fraction);
    const shown = this.live ?? base;
    const angle = START_ANGLE + SWEEP * shown;

    this.arc.clear();
    // A zero-length arc still draws a round cap, which reads as a value that is not zero. Skip it.
    if (shown > 0.001) {
      this.arc
        .arc(0, 0, r + 3, START_ANGLE, angle)
        .stroke({ width: 2.5, color: this.knobStyle.arc, cap: "round" });
    }

    // With modulation moving the pointer, the value the knob is set to still has to be readable: it
    // is what a drag changes and what undo returns to. A short tick across the track marks it.
    this.notch.clear();
    if (this.live !== null) {
      const at = START_ANGLE + SWEEP * base;
      this.notch
        .moveTo(Math.cos(at) * (r + 0.5), Math.sin(at) * (r + 0.5))
        .lineTo(Math.cos(at) * (r + 5.5), Math.sin(at) * (r + 5.5))
        .stroke({ width: 2, color: this.knobStyle.label, cap: "butt" });
    }

    this.pointer
      .clear()
      .moveTo(Math.cos(angle) * (r * 0.35), Math.sin(angle) * (r * 0.35))
      .lineTo(Math.cos(angle) * (r * 0.85), Math.sin(angle) * (r * 0.85))
      .stroke({ width: 2, color: this.knobStyle.pointer, cap: "round" });
  }

  setStyle(style: BlockStyle): void {
    this.style = style;
    this.label.style.fill = style.knob.label;
    this.drawStatic();
    this.drawSocket();
    this.draw();
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}

import { Container, Graphics, Text } from "pixi.js";
import { JACK_LABEL_Y, type JackBlock as JackGeometry } from "../../face";
import { PORT_RADIUS } from "../../layout";
import {
  type Block,
  type BlockStyle,
  drawSocket,
  drawTile,
  fitText,
  type SocketState,
} from "./Block";

/**
 * A jack: one cell with the port's name at the top and a socket under it.
 *
 * The socket's colour comes from the port's signal role, which comes from the engine's own
 * descriptor, so a module added to the engine draws its jacks correctly with no change here, and the
 * colour a cable is drawn in always matches the socket it leaves. Where the socket sits in the cell
 * is the face's decision, handed in as geometry.
 */
export class JackBlock implements Block {
  readonly view = new Container();
  private readonly tile = new Graphics();
  private readonly ring = new Graphics();
  private readonly label: Text;
  private state: SocketState = { connected: false, hovered: false };
  private color: number;

  constructor(
    readonly geometry: JackGeometry,
    style: BlockStyle,
  ) {
    this.color = style.signal[geometry.socket.port.role] ?? style.signal.any;
    this.view.position.set(geometry.x, geometry.y);
    this.ring.position.set(
      geometry.socket.x - geometry.x,
      geometry.socket.y - geometry.y,
    );
    this.label = new Text({
      text: geometry.socket.port.name,
      style: {
        fontSize: 6,
        fill: style.knob.label,
        fontFamily: "system-ui, sans-serif",
      },
    });
    // A cell is narrow and port names come from the descriptor; one that does not fit is trimmed
    // rather than spilling into the neighbouring tile.
    fitText(this.label, geometry.width - 2);
    this.label.anchor.set(0.5, 1);
    this.label.position.set(geometry.width / 2, JACK_LABEL_Y);
    this.view.addChild(this.tile, this.label, this.ring);
    drawTile(this.tile, geometry, style.tile);
    drawSocket(this.ring, PORT_RADIUS, this.color, this.state);
  }

  update(next: Partial<SocketState>): void {
    const merged = { ...this.state, ...next };
    if (
      merged.connected === this.state.connected &&
      merged.hovered === this.state.hovered
    )
      return;
    this.state = merged;
    drawSocket(this.ring, PORT_RADIUS, this.color, this.state);
  }

  setStyle(style: BlockStyle): void {
    this.color =
      style.signal[this.geometry.socket.port.role] ?? style.signal.any;
    this.label.style.fill = style.knob.label;
    drawTile(this.tile, this.geometry, style.tile);
    drawSocket(this.ring, PORT_RADIUS, this.color, this.state);
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}

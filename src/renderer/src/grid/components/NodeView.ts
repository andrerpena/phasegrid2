import { hexToNumber } from "@renderer/lib/color";
import { paramValue } from "@renderer/patch/params";
import type { GridColors } from "@renderer/theming/theme";
import type { ModuleDescriptor } from "@shared/protocol/catalog";
import type { PatchModule } from "@shared/protocol/patch";
import { Container, Graphics, Text } from "pixi.js";
import { measureNode, type NodeLayout, paramFraction } from "../layout";
import { KnobRow } from "./KnobRow";
import { faceStyle, OscillatorFace } from "./OscillatorFace";
import { Port } from "./Port";

/**
 * One module on the grid: a framed panel with a title, ports down its sides and its performance
 * controls on its face.
 *
 * Everything about how it looks comes from the engine's descriptor and the theme. There is no table
 * here mapping module ids to appearances, which is what makes adding a module to the engine enough to
 * see it drawn correctly.
 *
 * Built once and updated in place. A patch redraws whenever a parameter moves, and rebuilding a node's
 * graphics on every frame is how a canvas starts dropping them.
 */

export interface NodeStyle {
  colors: GridColors;
  /** The module's accent, from its category, used for the title and the value arcs. */
  accent: number;
}

export class NodeView {
  readonly view = new Container();
  readonly layout: NodeLayout;

  private readonly frame = new Graphics();
  private readonly title: Text;
  private readonly ports = new Map<string, Port>();
  /**
   * The controls between the port columns. A module that draws its wave wears an `OscillatorFace`,
   * wave on the left and knobs on the right; every other module wears the knobs alone. Both take the
   * layout's geometry and the theme and nothing else, so what a node is made of is decided here once.
   */
  private readonly face: OscillatorFace | KnobRow;
  private selected = false;

  constructor(
    /**
     * The module as the document last described it, for drawing and for nothing else.
     *
     * Deliberately not readable from outside. A value read back off a node is a value read off a copy,
     * and a copy is a thing that can be out of date; anything that needs to know what a parameter is
     * set to asks the document, which is where parameter values live. This is only ever compared with
     * the next module handed in, to tell whether there is anything to redraw.
     */
    private module: PatchModule,
    readonly descriptor: ModuleDescriptor,
    private style: NodeStyle,
  ) {
    this.layout = measureNode(descriptor);

    this.title = new Text({
      text: module.label ?? descriptor.name,
      style: {
        fontSize: 11,
        fill: style.accent,
        fontFamily: "system-ui, sans-serif",
      },
    });
    this.title.anchor.set(0.5, 0);
    this.title.position.set(this.layout.width / 2, 4);

    this.view.addChild(this.frame, this.title);
    this.drawFrame();

    const colors = faceStyle(style.colors, style.accent);
    this.face =
      this.layout.display !== null
        ? new OscillatorFace(this.layout.display, this.layout.controls, colors)
        : new KnobRow(this.layout.controls, colors.knob);
    this.view.addChild(this.face.view);
    this.applyValues(module);

    for (const port of [...this.layout.inputs, ...this.layout.outputs]) {
      const socket = new Port(
        4,
        hexToNumber(
          style.colors.signal[port.port.role] ?? style.colors.signal.any,
        ),
      );
      socket.view.position.set(port.x, port.y);
      this.ports.set(port.port.id, socket);
      this.view.addChild(socket.view);
    }

    this.view.position.set(module.x ?? 0, module.y ?? 0);
  }

  /**
   * The wave to show on the panel: one cycle, -1..1, as the engine drew it.
   *
   * The node never works this out for itself. The picture comes from the module that makes the sound,
   * through `module.preview`, and is handed in here by whoever asked for it; a node with no panel
   * ignores it.
   */
  setWave(samples: ArrayLike<number>): void {
    if (this.face instanceof OscillatorFace) this.face.setWave(samples);
  }

  /**
   * Where modulation has put a parameter this frame, 0..1 of its range, or null once nothing feeds
   * it. Telemetry's channel into the node, kept apart from the document's: it moves the pointer and
   * never the value.
   */
  setLive(paramId: string, fraction: number | null): void {
    this.face.setLive(paramId, fraction);
  }

  /** Every knob to the document's value for it. */
  private applyValues(module: PatchModule): void {
    for (const control of this.layout.controls) {
      this.face.setValue(
        control.param.id,
        paramFraction(
          control.param,
          paramValue(module, this.descriptor, control.param.id),
        ),
      );
    }
  }

  private drawFrame(): void {
    const { width, height } = this.layout;
    this.frame
      .clear()
      .roundRect(0, 0, width, height, 6)
      .fill({ color: hexToNumber(this.style.colors.nodeFill) })
      .stroke({
        width: this.selected ? 2 : 1,
        color: this.selected
          ? hexToNumber(this.style.colors.nodeSelected)
          : hexToNumber(this.style.colors.nodeStroke),
      })
      // A hairline under the title separates the name from the controls, which matters once a node has
      // four knobs and the title stops being the only text on it.
      .moveTo(1, 18)
      .lineTo(width - 1, 18)
      .stroke({
        width: 1,
        color: hexToNumber(this.style.colors.gridLine),
        alpha: 0.8,
      });
  }

  setSelected(selected: boolean): void {
    if (selected === this.selected) return;
    this.selected = selected;
    this.drawFrame();
  }

  setPosition(x: number, y: number): void {
    this.view.position.set(x, y);
  }

  /**
   * Re-reads the module from the document. Called whenever the patch changes, which during a knob drag
   * is every frame.
   *
   * The knobs are only redrawn when the module is a different object than last time. `applyOps` builds
   * a new object for the module it changed and reuses every other, so a drag on one knob costs one
   * node's redraw rather than the whole patch's. The ports are refreshed regardless, because hovering
   * changes them without the document changing at all.
   */
  update(
    module: PatchModule,
    connectedPorts: ReadonlySet<string>,
    hoveredPort: string | null,
  ): void {
    if (module !== this.module) {
      this.module = module;
      this.applyValues(module);
    }
    for (const [id, socket] of this.ports)
      socket.update({
        connected: connectedPorts.has(id),
        hovered: hoveredPort === id,
      });
    // A knob nothing feeds any more goes back to drawing its own value at once, rather than staying
    // wherever the last telemetry frame left it until the next one, which never comes.
    for (const control of this.layout.controls)
      if (
        control.modulationPort !== null &&
        !connectedPorts.has(control.modulationPort)
      )
        this.face.setLive(control.param.id, null);
  }

  setStyle(style: NodeStyle): void {
    this.style = style;
    this.title.style.fill = style.accent;
    this.drawFrame();
    const colors = faceStyle(style.colors, style.accent);
    if (this.face instanceof OscillatorFace) this.face.setStyle(colors);
    else this.face.setStyle(colors.knob);
  }

  destroy(): void {
    this.face.destroy();
    for (const port of this.ports.values()) port.destroy();
    this.view.destroy({ children: true });
  }
}

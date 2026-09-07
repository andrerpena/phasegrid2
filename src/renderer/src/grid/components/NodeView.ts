import { hexToNumber } from "@renderer/lib/color";
import type { GridColors } from "@renderer/theming/theme";
import type { ModuleDescriptor } from "@shared/protocol/catalog";
import type { PatchModule } from "@shared/protocol/patch";
import { Container, Graphics, Text } from "pixi.js";
import {
  KNOB_CELL_WIDTH,
  measureNode,
  type NodeLayout,
  paramFraction,
} from "../layout";
import { Knob } from "./Knob";
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
  private readonly knobs = new Map<string, Knob>();
  private selected = false;

  constructor(
    readonly module: PatchModule,
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

    for (const control of this.layout.controls) {
      const knob = new Knob(
        control.radius,
        control.param.name,
        {
          arc: style.accent,
          track: hexToNumber(style.colors.gridLine),
          body: hexToNumber(style.colors.knobBody),
          pointer: hexToNumber(style.colors.knobPointer),
          label: hexToNumber(style.colors.knobLabel),
        },
        KNOB_CELL_WIDTH - 4,
      );
      knob.view.position.set(control.x, control.y);
      knob.update(paramFraction(control.param, this.valueOf(control.param.id)));
      this.knobs.set(control.param.id, knob);
      this.view.addChild(knob.view);
    }

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

  private valueOf(paramId: string): number {
    const explicit = this.module.params?.[paramId];
    if (explicit !== undefined) return explicit;
    return this.descriptor.params.find((p) => p.id === paramId)?.default ?? 0;
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

  /** Re-reads the module's values. Called when the patch changes rather than every frame. */
  update(
    module: PatchModule,
    connectedPorts: ReadonlySet<string>,
    hoveredPort: string | null,
  ): void {
    for (const [id, knob] of this.knobs) {
      const param = this.descriptor.params.find((p) => p.id === id);
      if (param === undefined) continue;
      const value = module.params?.[id] ?? param.default;
      knob.update(paramFraction(param, value));
    }
    for (const [id, socket] of this.ports) {
      const connected = connectedPorts.has(id);
      socket.update({ connected, hovered: hoveredPort === id });
      // An implicit port shows once something is plugged into it, or while the node is hovered.
      const implicit =
        this.layout.inputs.find((p) => p.port.id === id)?.port.implicit ??
        false;
      socket.view.visible = !implicit || connected || hoveredPort !== null;
    }
  }

  setStyle(style: NodeStyle): void {
    this.style = style;
    this.title.style.fill = style.accent;
    this.drawFrame();
  }

  destroy(): void {
    for (const knob of this.knobs.values()) knob.destroy();
    for (const port of this.ports.values()) port.destroy();
    this.view.destroy({ children: true });
  }
}

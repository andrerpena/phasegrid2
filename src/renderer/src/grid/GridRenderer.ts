import { hexToNumber } from "@renderer/lib/color";
import type { PhasegridTheme } from "@renderer/theming/theme";
import type { ModuleDescriptor } from "@shared/protocol/catalog";
import type { PatchDoc } from "@shared/protocol/patch";
import { type Application, Container, Graphics } from "pixi.js";
import { Cable, cableControlPoints } from "./components/Cable";
import { NodeView } from "./components/NodeView";
import { hitControl, hitPort, type PortEdge, type PortLayout } from "./layout";
import { Viewport } from "./viewport";

/**
 * Draws the patch.
 *
 * Imperative and outside React on purpose. React is good at deciding what should exist; it is the wrong
 * tool for moving a hundred nodes at sixty frames a second while a pointer drags them. So React owns
 * the canvas element's lifetime and nothing else, and this owns everything inside it.
 *
 * Nodes are built when they appear and updated in place after that. Rebuilding on every change would be
 * simpler to write and would drop frames the moment a patch got interesting.
 */

/** Accent per category, so a patch reads by shape and colour rather than by reading every title. */
const CATEGORY_ACCENT: Record<string, keyof PhasegridTheme["grid"]["signal"]> =
  {
    osc: "audio",
    filter: "audio",
    fx: "audio",
    amp: "audio",
    env: "cv",
    mod: "cv",
    math: "cv",
    phase: "phase",
    note: "note",
    notes: "note",
    io: "any",
    display: "any",
    sampler: "audio",
  };

export class GridRenderer {
  readonly viewport: Viewport;
  private readonly world = new Container();
  private readonly background = new Graphics();
  private readonly cableLayer = new Container();
  private readonly nodeLayer = new Container();
  private readonly overlay = new Graphics();

  private readonly nodes = new Map<string, NodeView>();
  private readonly cables = new Map<string, Cable>();
  private selection = new Set<string>();
  private hoveredNode: string | null = null;
  /** The last document drawn, so cables can be redrawn without one being passed in again. */
  private doc: PatchDoc | null = null;

  constructor(
    private readonly app: Application,
    private theme: PhasegridTheme,
    private catalog: Map<string, ModuleDescriptor>,
  ) {
    // Cables under nodes, so a cable passing behind a module looks like it goes behind it.
    this.world.addChild(this.cableLayer, this.nodeLayer);
    app.stage.addChild(this.background, this.world, this.overlay);
    this.viewport = new Viewport(this.world);
    this.drawBackground();
  }

  /** The grid rules. Drawn in screen space so the lines stay one pixel wide at any zoom. */
  drawBackground(): void {
    const { width, height } = this.app.screen;
    const spacing = 24 * this.viewport.zoom;
    this.background
      .clear()
      .rect(0, 0, width, height)
      .fill({ color: hexToNumber(this.theme.grid.background) });
    if (spacing < 6) return; // Too dense to read; drawing it would just be noise.
    const color = hexToNumber(this.theme.grid.gridLine);
    const offsetX = this.viewport.x % spacing;
    const offsetY = this.viewport.y % spacing;
    for (let x = offsetX; x < width; x += spacing) {
      this.background.moveTo(x, 0).lineTo(x, height);
    }
    for (let y = offsetY; y < height; y += spacing) {
      this.background.moveTo(0, y).lineTo(width, y);
    }
    this.background.stroke({ width: 1, color, alpha: 0.9 });
  }

  private accentFor(descriptor: ModuleDescriptor): number {
    const role = CATEGORY_ACCENT[descriptor.category] ?? "any";
    return hexToNumber(this.theme.grid.signal[role]);
  }

  /** Reconciles what is drawn with the document. Called when the patch changes, not every frame. */
  sync(doc: PatchDoc): void {
    this.doc = doc;
    const seen = new Set<string>();
    for (const module of doc.modules) {
      seen.add(module.id);
      const descriptor = this.catalog.get(module.type);
      if (descriptor === undefined) continue; // A type this build does not know: drawn as nothing.
      let node = this.nodes.get(module.id);
      if (node === undefined || node.descriptor.id !== descriptor.id) {
        node?.destroy();
        node = new NodeView(module, descriptor, {
          colors: this.theme.grid,
          accent: this.accentFor(descriptor),
        });
        this.nodes.set(module.id, node);
        this.nodeLayer.addChild(node.view);
      }
      node.setPosition(module.x ?? 0, module.y ?? 0);
      node.update(
        module,
        this.connectedPortsOf(doc, module.id),
        this.hoveredNode === module.id ? "" : null,
      );
      node.setSelected(this.selection.has(module.id));
    }
    for (const [id, node] of this.nodes) {
      if (seen.has(id)) continue;
      node.destroy();
      this.nodes.delete(id);
    }

    const seenEdges = new Set<string>();
    for (const edge of doc.edges) {
      seenEdges.add(edge.id);
      const from = this.portPosition(
        edge.from.module,
        edge.from.port,
        "output",
      );
      const to = this.portPosition(edge.to.module, edge.to.port, "input");
      if (from === null || to === null) continue;
      let cable = this.cables.get(edge.id);
      if (cable === undefined) {
        cable = new Cable(this.cableColor(edge.from.module, edge.from.port));
        this.cables.set(edge.id, cable);
        this.cableLayer.addChild(cable.view);
      }
      cable.setColor(this.cableColor(edge.from.module, edge.from.port));
      cable.update(from, to, { toEdge: to.edge });
    }
    for (const [id, cable] of this.cables) {
      if (seenEdges.has(id)) continue;
      cable.destroy();
      this.cables.delete(id);
    }
  }

  /**
   * Redraws the cables against where the nodes are now.
   *
   * Dragging moves nodes on the canvas without touching the document, so the cables have to be told.
   * Without this they stay pinned to where the modules used to be and the patch appears to come apart
   * while a drag is in progress.
   */
  refreshCables(): void {
    if (this.doc === null) return;
    for (const edge of this.doc.edges) {
      const cable = this.cables.get(edge.id);
      const from = this.portPosition(
        edge.from.module,
        edge.from.port,
        "output",
      );
      const to = this.portPosition(edge.to.module, edge.to.port, "input");
      if (cable === undefined || from === null || to === null) continue;
      cable.update(from, to, { toEdge: to.edge });
    }
  }

  private connectedPortsOf(doc: PatchDoc, moduleId: string): Set<string> {
    const connected = new Set<string>();
    for (const edge of doc.edges) {
      if (edge.from.module === moduleId) connected.add(edge.from.port);
      if (edge.to.module === moduleId) connected.add(edge.to.port);
    }
    return connected;
  }

  /** A cable takes the colour of the port it leaves, so a signal can be followed across a patch. */
  private cableColor(moduleId: string, portId: string): number {
    return this.portColor(moduleId, portId, "output");
  }

  /** The colour a port's role gives it, which is also the colour of a cable drawn from it. */
  portColor(
    moduleId: string,
    portId: string,
    side: "input" | "output",
  ): number {
    const node = this.nodes.get(moduleId);
    const list = side === "output" ? node?.layout.outputs : node?.layout.inputs;
    const role = list?.find((p) => p.port.id === portId)?.port.role ?? "any";
    return hexToNumber(
      this.theme.grid.signal[role] ?? this.theme.grid.signal.any,
    );
  }

  /**
   * The socket under a point, or null.
   *
   * Searched across every node rather than through `nodeAt`: sockets sit on a module's borders and
   * their grab radius reaches outside it, so a point a few pixels past the border can still be on a
   * socket while being on no node. With `knobs`, a point on a knob counts as its modulation socket:
   * right for a cable being dropped, where the knob is the thing you aim at, and wrong for a press,
   * where a knob pressed is a knob to turn.
   */
  portAt(
    point: { x: number; y: number },
    options: { knobs?: boolean } = {},
  ): { module: string; port: PortLayout; x: number; y: number } | null {
    const entries = [...this.nodes.entries()].reverse();
    for (const [id, node] of entries) {
      const origin = { x: node.view.position.x, y: node.view.position.y };
      const port =
        hitPort(point, origin, node.layout) ??
        (options.knobs === true
          ? this.socketOfKnob(node, hitControl(point, origin, node.layout))
          : null);
      if (port !== null)
        return { module: id, port, x: origin.x + port.x, y: origin.y + port.y };
    }
    return null;
  }

  private socketOfKnob(
    node: NodeView,
    control: { modulationPort: string | null } | null,
  ): PortLayout | null {
    if (control === null || control.modulationPort === null) return null;
    return (
      node.layout.inputs.find((p) => p.port.id === control.modulationPort) ??
      null
    );
  }

  /**
   * Where a port sits in patch coordinates, and which border it is on, or null when the module is not
   * drawn.
   */
  portPosition(
    moduleId: string,
    portId: string,
    side: "input" | "output",
  ): { x: number; y: number; edge: PortEdge } | null {
    const node = this.nodes.get(moduleId);
    if (node === undefined) return null;
    const list = side === "output" ? node.layout.outputs : node.layout.inputs;
    const port = list.find((p) => p.port.id === portId);
    if (port === undefined) return null;
    return {
      x: node.view.position.x + port.x,
      y: node.view.position.y + port.y,
      edge: port.edge,
    };
  }

  setSelection(ids: Set<string>): void {
    this.selection = ids;
    for (const [id, node] of this.nodes) node.setSelected(ids.has(id));
  }

  /** The marquee and the cable being dragged: transient things drawn over everything else. */
  drawOverlay(
    marquee: { x: number; y: number; width: number; height: number } | null,
    pendingCable: {
      from: { x: number; y: number };
      to: { x: number; y: number };
      color: number;
      /** The border the cable is heading for, once it is over a socket. */
      toEdge?: PortEdge;
    } | null,
  ): void {
    this.overlay.clear();
    if (marquee !== null) {
      const topLeft = this.viewport.toScreen({ x: marquee.x, y: marquee.y });
      this.overlay
        .rect(
          topLeft.x,
          topLeft.y,
          marquee.width * this.viewport.zoom,
          marquee.height * this.viewport.zoom,
        )
        .fill({ color: hexToNumber(this.theme.grid.marquee), alpha: 0.12 })
        .stroke({ width: 1, color: hexToNumber(this.theme.grid.marquee) });
    }
    if (pendingCable !== null) {
      // The same curve a finished cable takes, so the drag shows where the cable will actually lie.
      const [c1, c2] = cableControlPoints(
        pendingCable.from,
        pendingCable.to,
        pendingCable.toEdge,
      );
      const from = this.viewport.toScreen(pendingCable.from);
      const to = this.viewport.toScreen(pendingCable.to);
      const p1 = this.viewport.toScreen(c1);
      const p2 = this.viewport.toScreen(c2);
      this.overlay
        .moveTo(from.x, from.y)
        .bezierCurveTo(p1.x, p1.y, p2.x, p2.y, to.x, to.y)
        .stroke({
          width: 2,
          color: pendingCable.color,
          alpha: 0.8,
          cap: "round",
        });
    }
  }

  setTheme(theme: PhasegridTheme): void {
    this.theme = theme;
    this.drawBackground();
    for (const node of this.nodes.values()) {
      node.setStyle({
        colors: theme.grid,
        accent: this.accentFor(node.descriptor),
      });
    }
  }

  setCatalog(catalog: Map<string, ModuleDescriptor>): void {
    this.catalog = catalog;
  }

  /** Everything the patch occupies, for zoom to fit. */
  bounds() {
    if (this.nodes.size === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of this.nodes.values()) {
      minX = Math.min(minX, node.view.position.x);
      minY = Math.min(minY, node.view.position.y);
      maxX = Math.max(maxX, node.view.position.x + node.layout.width);
      maxY = Math.max(maxY, node.view.position.y + node.layout.height);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  nodeAt(point: {
    x: number;
    y: number;
  }): { id: string; node: NodeView } | null {
    // Reverse order: the node drawn last is the one on top, and that is the one a click means.
    const entries = [...this.nodes.entries()].reverse();
    for (const [id, node] of entries) {
      const origin = { x: node.view.position.x, y: node.view.position.y };
      if (
        point.x >= origin.x &&
        point.x <= origin.x + node.layout.width &&
        point.y >= origin.y &&
        point.y <= origin.y + node.layout.height
      )
        return { id, node };
    }
    return null;
  }

  allNodes(): Map<string, NodeView> {
    return this.nodes;
  }

  /** The modules drawn right now that have a wave panel to fill. */
  previewing(): string[] {
    return [...this.nodes]
      .filter(([, node]) => node.descriptor.flags.previewsWave)
      .map(([id]) => id);
  }

  /** Puts a cycle the engine drew onto a module's panel. Ignored for a module not drawn. */
  setPreview(moduleId: string, samples: ArrayLike<number>): void {
    this.nodes.get(moduleId)?.setWave(samples);
  }

  /** Where modulation has put a knob this frame, 0..1, or null. Ignored for a module not drawn. */
  setLive(moduleId: string, paramId: string, fraction: number | null): void {
    this.nodes.get(moduleId)?.setLive(paramId, fraction);
  }

  destroy(): void {
    for (const node of this.nodes.values()) node.destroy();
    for (const cable of this.cables.values()) cable.destroy();
    this.nodes.clear();
    this.cables.clear();
  }
}

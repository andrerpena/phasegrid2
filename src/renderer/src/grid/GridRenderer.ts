import { hexToNumber } from "@renderer/lib/color";
import type { PhasegridTheme } from "@renderer/theming/theme";
import type { ModuleDescriptor } from "@shared/protocol/catalog";
import type { PatchDoc } from "@shared/protocol/patch";
import { type Application, Container, Graphics } from "pixi.js";
import { Cable, cableControlPoints } from "./components/Cable";
import { NodeView } from "./components/NodeView";
import { type Facing, hitKnob, hitSocket, type Socket, socketOf } from "./face";
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

/**
 * The selection ring traces the node's own edge: same rectangle, same corner radius as `drawFrame`,
 * straddling the border so it reads as that border lit up rather than a second outline around it.
 */
const SELECTION_RADIUS = 6;
const SELECTION_WIDTH = 2;

/**
 * What is drawn over what, bottom to top. The one place the order is decided.
 *
 * The rules of the ground are drawn in screen space under everything. In the world, which pans and
 * zooms as one: the modules; the selection rings, which trace a module's edge and so belong with it;
 * then the cables, over both, because every socket is inside a tile and a cable has to be seen
 * reaching it the way a patch cable lies over a rack. The marquee and a cable being dragged are
 * transient and go in the screen-space overlay above all of it.
 */
const WORLD_LAYERS = ["nodes", "selection", "cables"] as const;
type WorldLayer = (typeof WORLD_LAYERS)[number];

export class GridRenderer {
  readonly viewport: Viewport;
  private readonly world = new Container();
  private readonly background = new Graphics();
  private readonly cableLayer = new Container();
  private readonly nodeLayer = new Container();
  private readonly selectionLayer = new Graphics();
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
    const layers: Record<WorldLayer, Container> = {
      nodes: this.nodeLayer,
      selection: this.selectionLayer,
      cables: this.cableLayer,
    };
    this.world.addChild(...WORLD_LAYERS.map((name) => layers[name]));
    app.stage.addChild(this.background, this.world, this.overlay);
    this.viewport = new Viewport(this.world);
    this.drawBackground();
  }

  /**
   * The surface is now this big.
   *
   * The renderer holds both the application and the ground drawn across it, so it is the one place
   * that can change the size and redraw against it in that order. Doing it the other way round
   * leaves the rules drawn for the box the canvas used to be.
   */
  resize(width: number, height: number): void {
    this.app.renderer.resize(width, height);
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
      cable.update(from, to, { toFacing: to.facing, fromFacing: from.facing });
    }
    for (const [id, cable] of this.cables) {
      if (seenEdges.has(id)) continue;
      cable.destroy();
      this.cables.delete(id);
    }

    // After the nodes, so a ring is drawn around a node that has just been created or moved by an
    // undo rather than around where it used to be.
    this.drawSelection();
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
      cable.update(from, to, { toFacing: to.facing, fromFacing: from.facing });
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
    const role =
      (node === undefined ? null : socketOf(node.face, portId, side))?.port
        .role ?? "any";
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
  ): { module: string; socket: Socket; x: number; y: number } | null {
    const entries = [...this.nodes.entries()].reverse();
    for (const [id, node] of entries) {
      const origin = { x: node.view.position.x, y: node.view.position.y };
      const socket =
        hitSocket(point, origin, node.face) ??
        (options.knobs === true
          ? (hitKnob(point, origin, node.face)?.socket ?? null)
          : null);
      if (socket !== null)
        return {
          module: id,
          socket,
          x: origin.x + socket.x,
          y: origin.y + socket.y,
        };
    }
    return null;
  }

  /**
   * Where a port's socket sits in patch coordinates, and which way it faces, or null when the module
   * is not drawn.
   */
  portPosition(
    moduleId: string,
    portId: string,
    side: "input" | "output",
  ): { x: number; y: number; facing: Facing } | null {
    const node = this.nodes.get(moduleId);
    if (node === undefined) return null;
    const socket = socketOf(node.face, portId, side);
    if (socket === null) return null;
    return {
      x: node.view.position.x + socket.x,
      y: node.view.position.y + socket.y,
      facing: socket.facing,
    };
  }

  setSelection(ids: Set<string>): void {
    this.selection = ids;
    this.drawSelection();
  }

  /**
   * A ring on each selected node's edge, covering the border the node drew for itself.
   *
   * It lives on its own layer rather than in the node's frame so that selecting something costs one
   * redraw of this layer instead of a redraw of every node that changed state.
   *
   * Redrawn on selection and on every move, because the rings are in world space and follow the
   * nodes rather than the pointer.
   */
  drawSelection(): void {
    this.selectionLayer.clear();
    if (this.selection.size === 0) return;
    const color = hexToNumber(this.theme.grid.nodeSelected);
    for (const id of this.selection) {
      const node = this.nodes.get(id);
      if (node === undefined) continue;
      const { x, y } = node.view.position;
      const { width, height } = node.face;
      this.selectionLayer
        .roundRect(x, y, width, height, SELECTION_RADIUS)
        .stroke({ width: SELECTION_WIDTH, color, alignment: 0.5 });
    }
  }

  /** The marquee and the cable being dragged: transient things drawn over everything else. */
  drawOverlay(
    marquee: { x: number; y: number; width: number; height: number } | null,
    pendingCable: {
      from: { x: number; y: number };
      to: { x: number; y: number };
      color: number;
      /** The ways the two sockets face, once the loose end is over one. */
      toFacing?: Facing;
      fromFacing?: Facing;
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
        pendingCable.toFacing,
        pendingCable.fromFacing,
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
    this.drawSelection();
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
      maxX = Math.max(maxX, node.view.position.x + node.face.width);
      maxY = Math.max(maxY, node.view.position.y + node.face.height);
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
        point.x <= origin.x + node.face.width &&
        point.y >= origin.y &&
        point.y <= origin.y + node.face.height
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

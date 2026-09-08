import type { PortRef } from "@shared/protocol/patch";
import type { GridRenderer } from "./GridRenderer";
import {
  beginDragCable,
  beginDragNodes,
  beginDragParam,
  beginMarquee,
  beginPan,
  canConnect,
  dragParamTo,
  IDLE,
  type Interaction,
  orientEdge,
  paramValueAt,
  pointerMove,
  pointerUp,
} from "./interaction";
import {
  CELL,
  hitControl,
  type Point,
  type PortLayout,
  paramFraction,
  snap,
} from "./layout";
import { classifyWheel } from "./wheel";

/** How far apart two fingers are. */
function touchSpread(touches: TouchList): number {
  const a = touches[0];
  const b = touches[1];
  if (a === undefined || b === undefined) return 0;
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/** The point a pinch is anchored on. */
function touchCentre(touches: TouchList): { x: number; y: number } {
  const a = touches[0];
  const b = touches[1];
  if (a === undefined || b === undefined) return { x: 0, y: 0 };
  return {
    x: (a.clientX + b.clientX) / 2,
    y: (a.clientY + b.clientY) / 2,
  };
}

/**
 * Everything a pointer can do on the grid, in one place.
 *
 * It lives here rather than in the React component so that the application and a story drive exactly
 * the same code. A story that used a second, simpler implementation would be showing something the
 * application does not do, which is worse than showing nothing.
 *
 * It reports what happened and changes nothing itself. The caller decides whether that becomes a patch
 * operation, an undo entry and a message to the engine, or just a value in a story's state.
 */

export interface GridOptions {
  /**
   * Parameters only: no moving, no marquee, no connecting.
   *
   * What an example project uses. Knob drags are deliberately still allowed, because changing values is
   * the entire point of a demonstration; what is withheld is only the wiring, which is what makes the
   * example an example rather than a document someone starts working in.
   *
   * A value or a function of one. It became a function when saving an example turned it into a project
   * of the user's own without the canvas being rebuilt: read once, the wiring would have stayed locked
   * in a document that was no longer an example.
   */
  parametersOnly?: boolean | (() => boolean);
}

export interface GridCallbacks {
  /**
   * What a parameter is set to right now.
   *
   * Supplied by the caller rather than read off the node, because the node draws the patch and does
   * not own it. A gesture has to begin from the value the document holds; asking the thing on screen
   * would be asking a copy, and a copy is how a knob ends up jumping back to the value it had when the
   * project was opened.
   */
  readParam?: (module: string, param: string) => number;
  /**
   * The cables plugged into an input right now, oldest first, each with its id and the output it
   * comes from. Read from the document for the same reason `readParam` is: the drawing is a copy.
   */
  readEdgesInto?: (
    module: string,
    port: string,
  ) => { id: string; from: PortRef }[];
  /** A finished drag. Positions are already snapped to the grid. */
  onNodesMoved?: (moves: { id: string; x: number; y: number }[]) => void;
  /**
   * A parameter changed. `done` is false while the knob is still being dragged and true once it is
   * released, which is what lets a caller write every intermediate value and record only one undo
   * entry for the gesture. `previous` is what the parameter was before the gesture began, which is
   * what that entry has to step back to.
   *
   * One object rather than four positional arguments, because a knob is going to learn to report more
   * than this once it can show a modulation amount.
   */
  onParamChange?: (change: {
    module: string;
    param: string;
    value: number;
    done: boolean;
    previous: number;
  }) => void;
  onSelectionChanged?: (ids: string[]) => void;
  /**
   * A cable was made. `replaces` names the edge it used to be, when it was picked up off one input
   * and dropped on another: the caller removes that one and adds this one as a single edit.
   */
  onConnect?: (
    from: PortRef,
    to: PortRef,
    options: { replaces?: string },
  ) => void;
  /** A cable picked up off an input and dropped on nothing. */
  onDisconnect?: (edgeId: string) => void;
}

export class GridInteraction {
  private state: Interaction = IDLE;
  private dragOrigins = new Map<string, { x: number; y: number }>();
  private selection = new Set<string>();
  private detach: (() => void)[] = [];
  /** Space is the pan modifier; see `attach`. */
  private spaceHeld = false;
  /** Distance between two fingers on the last touch frame, while a pinch is under way. */
  private pinchDistance: number | null = null;

  constructor(
    private readonly renderer: GridRenderer,
    private readonly canvas: HTMLCanvasElement,
    private readonly callbacks: GridCallbacks = {},
    private readonly options: GridOptions = {},
  ) {}

  /** Asked at every gesture rather than remembered, so a document that stops being an example unlocks. */
  private get parametersOnly(): boolean {
    const value = this.options.parametersOnly;
    return typeof value === "function" ? value() : value === true;
  }

  attach(): () => void {
    const down = (event: PointerEvent) => this.onDown(event);
    const move = (event: PointerEvent) => this.onMove(event);
    const up = (event: PointerEvent) => this.onUp(event);
    const wheel = (event: WheelEvent) => this.onWheel(event);
    const doubleClick = (event: MouseEvent) => this.onDoubleClick(event);
    const touchStart = (event: TouchEvent) => this.onTouchStart(event);
    const touchMove = (event: TouchEvent) => this.onTouchMove(event);
    const touchEnd = (event: TouchEvent) => this.onTouchEnd(event);

    // Space held is the pan modifier. Tracked on the window rather than read off each event, because
    // the space bar is pressed *before* the drag begins and a pointer event carries no record of it.
    const keyDown = (event: KeyboardEvent) => {
      if (event.code === "Space") this.spaceHeld = true;
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") this.spaceHeld = false;
    };
    // Losing the window loses the key: otherwise tabbing away mid-hold leaves the canvas convinced
    // space is still down and every click pans.
    const blur = () => {
      this.spaceHeld = false;
    };

    this.canvas.addEventListener("pointerdown", down);
    this.canvas.addEventListener("dblclick", doubleClick);
    // Move and release listen on the window, not the canvas: a drag that leaves the canvas must keep
    // working, and a release outside it must still end the gesture rather than leaving it stuck down.
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", blur);
    this.canvas.addEventListener("wheel", wheel, { passive: false });
    this.canvas.addEventListener("touchstart", touchStart, { passive: false });
    this.canvas.addEventListener("touchmove", touchMove, { passive: false });
    this.canvas.addEventListener("touchend", touchEnd);
    this.canvas.addEventListener("touchcancel", touchEnd);

    this.detach = [
      () => this.canvas.removeEventListener("pointerdown", down),
      () => this.canvas.removeEventListener("dblclick", doubleClick),
      () => window.removeEventListener("pointermove", move),
      () => window.removeEventListener("pointerup", up),
      () => window.removeEventListener("keydown", keyDown),
      () => window.removeEventListener("keyup", keyUp),
      () => window.removeEventListener("blur", blur),
      () => this.canvas.removeEventListener("wheel", wheel),
      () => this.canvas.removeEventListener("touchstart", touchStart),
      () => this.canvas.removeEventListener("touchmove", touchMove),
      () => this.canvas.removeEventListener("touchend", touchEnd),
      () => this.canvas.removeEventListener("touchcancel", touchEnd),
    ];
    return () => {
      for (const off of this.detach) off();
      this.detach = [];
    };
  }

  /**
   * Double-clicking a knob puts it back to the value the module was built with.
   *
   * The gesture every plug-in has, and it is an ordinary edit: written to the document, sent to the
   * engine and stepped back by undo like anything else. Reported as finished, because it is.
   */
  private onDoubleClick(event: MouseEvent): void {
    const point = this.renderer.viewport.toWorld({
      x: event.clientX - this.canvas.getBoundingClientRect().left,
      y: event.clientY - this.canvas.getBoundingClientRect().top,
    });
    const hit = this.renderer.nodeAt(point);
    if (hit === null) return;
    const origin = { x: hit.node.view.position.x, y: hit.node.view.position.y };
    const control = hitControl(point, origin, hit.node.layout);
    if (control === null) return;
    const previous =
      this.callbacks.readParam?.(hit.id, control.param.id) ??
      control.param.default;
    if (previous === control.param.default) return; // already there: nothing to record
    this.callbacks.onParamChange?.({
      module: hit.id,
      param: control.param.id,
      value: control.param.default,
      done: true,
      previous,
    });
  }

  /** Screen coordinates relative to the canvas, which is what the viewport converts from. */
  private screen(event: PointerEvent | WheelEvent) {
    const box = this.canvas.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  private onDown(event: PointerEvent): void {
    const screen = this.screen(event);
    const point = this.renderer.viewport.toWorld(screen);

    // Middle button pans. Every canvas application does this and muscle memory outweighs any argument
    // for something else. Space and the left button do too, for the laptops that have no middle one --
    // which is most of them, and was the reason panning was effectively unreachable.
    if (event.button === 1 || (event.button === 0 && this.spaceHeld)) {
      this.state = beginPan(screen);
      return;
    }

    // A socket before anything else: they sit on the borders, where a module's own hit box and the
    // gap beside it meet, and grabbing one has to work from either side of that line.
    if (!this.parametersOnly) {
      const socket = this.renderer.portAt(point);
      if (socket !== null) {
        this.state = this.pickUpCable(socket.module, socket.port, point);
        return;
      }
    }

    const hit = this.renderer.nodeAt(point);
    if (hit !== null) {
      const origin = {
        x: hit.node.view.position.x,
        y: hit.node.view.position.y,
      };
      // A knob before the body, so grabbing a control does not drag the module it sits on.
      const control = hitControl(point, origin, hit.node.layout);
      if (control !== null) {
        const value =
          this.callbacks.readParam?.(hit.id, control.param.id) ??
          control.param.default;
        this.state = beginDragParam(
          hit.id,
          control.param.id,
          event.clientY,
          paramFraction(control.param, value),
        );
        return;
      }

      this.select(event.shiftKey ? [...this.selection, hit.id] : [hit.id]);
      // Selecting still works, because selecting is how the inspector knows what to show. Only the
      // dragging is withheld.
      if (this.parametersOnly) return;
      this.dragOrigins.clear();
      for (const id of this.selection) {
        const node = this.renderer.allNodes().get(id);
        if (node !== undefined)
          this.dragOrigins.set(id, {
            x: node.view.position.x,
            y: node.view.position.y,
          });
      }
      this.state = beginDragNodes([...this.selection], point);
      return;
    }

    if (this.parametersOnly) {
      if (!event.shiftKey) this.select([]);
      return;
    }
    this.state = beginMarquee(point, event.shiftKey);
    if (!event.shiftKey) this.select([]);
  }

  /**
   * A press on a socket starts a cable.
   *
   * From an output, or an input with nothing in it, that is a new cable. From an input that already
   * has one, it is that cable being picked up: the gesture continues from the output it came from,
   * and the edge it was travels with it so the drop can move or remove it. With several cables in
   * one input the most recent one comes off, which is the one still under the hand, as it were.
   */
  private pickUpCable(
    module: string,
    port: PortLayout,
    at: Point,
  ): Interaction {
    const ref: PortRef = { module, port: port.port.id };
    if (port.side === "input") {
      const existing =
        this.callbacks.readEdgesInto?.(module, port.port.id) ?? [];
      const last = existing.at(-1);
      if (last !== undefined)
        return beginDragCable(last.from, "output", at, last.id);
    }
    return beginDragCable(ref, port.side, at);
  }

  /**
   * The cable being dragged, drawn from its fixed end to the pointer, or to the socket the pointer
   * is over so it visibly snaps. Always drawn output to input, whichever end is in the hand, so the
   * curve leans the way the finished cable will.
   */
  private drawPendingCable(
    state: Extract<Interaction, { kind: "dragCable" }>,
  ): void {
    const anchor = this.renderer.portPosition(
      state.from.module,
      state.from.port,
      state.fromSide,
    );
    if (anchor === null) return;
    const over = this.renderer.portAt(state.current, { knobs: true });
    const loose =
      over !== null && over.port.side !== state.fromSide
        ? { x: over.x, y: over.y, edge: over.port.edge }
        : { x: state.current.x, y: state.current.y, edge: "left" as const };
    const color = this.renderer.portColor(
      state.from.module,
      state.from.port,
      state.fromSide,
    );
    const [from, to] =
      state.fromSide === "output" ? [anchor, loose] : [loose, anchor];
    this.renderer.drawOverlay(null, {
      from,
      to,
      color,
      toEdge: to.edge,
    });
  }

  /**
   * A cable let go. On a socket it can join: a new edge, or the picked-up edge moved there. On
   * nothing: a picked-up edge is removed, a new one simply never existed. A cable that lands where
   * an identical one already runs, including back where it was picked up from, changes nothing.
   */
  private dropCable(drop: {
    from: PortRef;
    fromSide: "input" | "output";
    at: Point;
    detach?: string;
  }): void {
    const target = this.renderer.portAt(drop.at, { knobs: true });
    if (target !== null) {
      const to: PortRef = { module: target.module, port: target.port.port.id };
      if (canConnect(drop.fromSide, target.port.side, drop.from, to)) {
        const edge = orientEdge(drop.from, drop.fromSide, to);
        const existing = (
          this.callbacks.readEdgesInto?.(edge.to.module, edge.to.port) ?? []
        ).find(
          (e) =>
            e.from.module === edge.from.module &&
            e.from.port === edge.from.port,
        );
        if (existing === undefined) {
          this.callbacks.onConnect?.(edge.from, edge.to, {
            ...(drop.detach === undefined ? {} : { replaces: drop.detach }),
          });
        } else if (drop.detach !== undefined && existing.id !== drop.detach) {
          // Moved onto an input that already has this very cable: the moved one is now surplus.
          this.callbacks.onDisconnect?.(drop.detach);
        }
        return;
      }
    }
    if (drop.detach !== undefined) this.callbacks.onDisconnect?.(drop.detach);
  }

  private onMove(event: PointerEvent): void {
    if (this.state.kind === "idle") return;

    if (this.state.kind === "dragParam") {
      const next = dragParamTo(this.state, event.clientY, event.shiftKey);
      this.state = next;
      const node = this.renderer.allNodes().get(next.module);
      const param = node?.descriptor.params.find((p) => p.id === next.param);
      if (param === undefined) return;
      // Reported live: the caller writes it to the document, the document redraws the knob, and the
      // engine hears it. Nothing here moves the knob directly — one path, so there is nothing to
      // disagree with. The undo entry waits for the release.
      this.callbacks.onParamChange?.({
        module: next.module,
        param: next.param,
        value: paramValueAt(param, next.fraction),
        done: false,
        previous: paramValueAt(param, this.state.startFraction),
      });
      return;
    }

    if (this.state.kind === "panning") {
      const result = pointerMove(this.state, this.screen(event));
      this.state = result.next;
      if (result.pan !== undefined)
        this.renderer.viewport.panBy(result.pan.x, result.pan.y);
      this.renderer.drawBackground();
      return;
    }

    const point = this.renderer.viewport.toWorld(this.screen(event));
    const result = pointerMove(this.state, point);
    this.state = result.next;

    if (this.state.kind === "dragCable") {
      this.drawPendingCable(this.state);
      return;
    }

    if (this.state.kind === "dragNodes" && this.state.moved) {
      // Moved on the canvas without telling anyone: the drag is one edit, and it is reported when it
      // ends. Sending each frame would flood the engine and fill the history with a hundred entries.
      const dx = this.state.last.x - this.state.start.x;
      const dy = this.state.last.y - this.state.start.y;
      for (const [id, from] of this.dragOrigins) {
        const node = this.renderer.allNodes().get(id);
        node?.setPosition(snap(from.x + dx, CELL), snap(from.y + dy, CELL));
      }
      this.renderer.refreshCables();
      // The rings are drawn around where the nodes are, so a drag has to move them too.
      this.renderer.drawSelection();
      return;
    }

    if (this.state.kind === "marquee") {
      this.renderer.drawOverlay(
        {
          x: Math.min(this.state.start.x, this.state.current.x),
          y: Math.min(this.state.start.y, this.state.current.y),
          width: Math.abs(this.state.start.x - this.state.current.x),
          height: Math.abs(this.state.start.y - this.state.current.y),
        },
        null,
      );
    }
  }

  private onUp(event: PointerEvent): void {
    if (this.state.kind === "idle") return;
    const point = this.renderer.viewport.toWorld(this.screen(event));
    const end = pointerUp(this.state, point);
    this.state = end.next;
    this.renderer.drawOverlay(null, null);

    if (end.committedParam !== undefined) {
      const { module, param, fraction, startFraction } = end.committedParam;
      const node = this.renderer.allNodes().get(module);
      const desc = node?.descriptor.params.find((p) => p.id === param);
      if (desc !== undefined) {
        this.callbacks.onParamChange?.({
          module,
          param,
          value: paramValueAt(desc, fraction),
          done: true,
          previous: paramValueAt(desc, startFraction),
        });
      }
      return;
    }

    if (end.cableDrop !== undefined) {
      this.dropCable(end.cableDrop);
      return;
    }

    if (end.committedMove !== undefined) {
      const dx = end.committedMove.to.x - end.committedMove.from.x;
      const dy = end.committedMove.to.y - end.committedMove.from.y;
      const moves = [...this.dragOrigins].map(([id, from]) => ({
        id,
        x: snap(from.x + dx, CELL),
        y: snap(from.y + dy, CELL),
      }));
      if (moves.length > 0) this.callbacks.onNodesMoved?.(moves);
      return;
    }

    if (end.marquee !== undefined) {
      const rect = end.marquee.rect;
      const inside: string[] = [];
      for (const [id, node] of this.renderer.allNodes()) {
        const x = node.view.position.x;
        const y = node.view.position.y;
        if (
          x < rect.x + rect.width &&
          x + node.layout.width > rect.x &&
          y < rect.y + rect.height &&
          y + node.layout.height > rect.y
        )
          inside.push(id);
      }
      this.select(
        end.marquee.additive ? [...this.selection, ...inside] : inside,
      );
    }
  }

  /**
   * The wheel: pan, or zoom, depending on what the gesture turns out to have been.
   *
   * Which it is comes from `classifyWheel`, which is where that judgement lives and where it is
   * tested. This is only the part that needs a viewport.
   */
  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    const gesture = classifyWheel(event);
    if (gesture.kind === "none") return;
    if (gesture.kind === "pan")
      this.renderer.viewport.panBy(gesture.dx, gesture.dy);
    else this.renderer.viewport.zoomAt(this.screen(event), gesture.factor);
    this.renderer.drawBackground();
  }

  private onTouchStart(event: TouchEvent): void {
    if (event.touches.length !== 2) return;
    event.preventDefault();
    // A pinch is not a drag: whatever gesture was in progress is abandoned rather than continuing
    // with one of the two fingers, which is how a two-finger zoom ends up dragging a module.
    this.state = IDLE;
    this.pinchDistance = touchSpread(event.touches);
  }

  private onTouchMove(event: TouchEvent): void {
    if (event.touches.length !== 2 || this.pinchDistance === null) return;
    event.preventDefault();
    const spread = touchSpread(event.touches);
    if (spread <= 0) return;
    const rect = this.canvas.getBoundingClientRect();
    const centre = touchCentre(event.touches);
    this.renderer.viewport.zoomAt(
      { x: centre.x - rect.left, y: centre.y - rect.top },
      spread / this.pinchDistance,
    );
    this.pinchDistance = spread;
    this.renderer.drawBackground();
  }

  private onTouchEnd(event: TouchEvent): void {
    if (event.touches.length < 2) this.pinchDistance = null;
  }

  private select(ids: string[]): void {
    this.selection = new Set(ids);
    this.renderer.setSelection(this.selection);
    this.callbacks.onSelectionChanged?.([...this.selection]);
  }
}

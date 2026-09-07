import type { PortRef } from "@shared/protocol/patch";
import type { GridRenderer } from "./GridRenderer";
import {
  beginDragNodes,
  beginDragParam,
  beginMarquee,
  beginPan,
  dragParamTo,
  IDLE,
  type Interaction,
  paramValueAt,
  pointerMove,
  pointerUp,
} from "./interaction";
import { CELL, hitControl, paramFraction, snap } from "./layout";

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
   */
  parametersOnly?: boolean;
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
  onConnect?: (from: PortRef, to: PortRef) => void;
}

export class GridInteraction {
  private state: Interaction = IDLE;
  private dragOrigins = new Map<string, { x: number; y: number }>();
  private selection = new Set<string>();
  private detach: (() => void)[] = [];

  constructor(
    private readonly renderer: GridRenderer,
    private readonly canvas: HTMLCanvasElement,
    private readonly callbacks: GridCallbacks = {},
    private readonly options: GridOptions = {},
  ) {}

  attach(): () => void {
    const down = (event: PointerEvent) => this.onDown(event);
    const move = (event: PointerEvent) => this.onMove(event);
    const up = (event: PointerEvent) => this.onUp(event);
    const wheel = (event: WheelEvent) => this.onWheel(event);
    const doubleClick = (event: MouseEvent) => this.onDoubleClick(event);

    this.canvas.addEventListener("pointerdown", down);
    this.canvas.addEventListener("dblclick", doubleClick);
    // Move and release listen on the window, not the canvas: a drag that leaves the canvas must keep
    // working, and a release outside it must still end the gesture rather than leaving it stuck down.
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    this.canvas.addEventListener("wheel", wheel, { passive: false });

    this.detach = [
      () => this.canvas.removeEventListener("pointerdown", down),
      () => this.canvas.removeEventListener("dblclick", doubleClick),
      () => window.removeEventListener("pointermove", move),
      () => window.removeEventListener("pointerup", up),
      () => this.canvas.removeEventListener("wheel", wheel),
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
    // for something else.
    if (event.button === 1) {
      this.state = beginPan(screen);
      return;
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
      if (this.options.parametersOnly === true) return;
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

    if (this.options.parametersOnly === true) {
      if (!event.shiftKey) this.select([]);
      return;
    }
    this.state = beginMarquee(point, event.shiftKey);
    if (!event.shiftKey) this.select([]);
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

  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    this.renderer.viewport.zoomAt(
      this.screen(event),
      event.deltaY < 0 ? 1.1 : 1 / 1.1,
    );
    this.renderer.drawBackground();
  }

  private select(ids: string[]): void {
    this.selection = new Set(ids);
    this.renderer.setSelection(this.selection);
    this.callbacks.onSelectionChanged?.([...this.selection]);
  }
}

import type { Point } from "./layout";
import type { Viewport } from "./viewport";

/**
 * The canvas's view, reachable from outside the canvas.
 *
 * The minimap needs to know where the view is and to move it; the zoom control needs to read and set
 * the zoom. Neither can be handed a Pixi object through React, because the canvas is built in an
 * effect and lives outside the tree — so the one live viewport is registered here when the canvas
 * mounts and cleared when it goes.
 *
 * Not a zustand store: nothing renders from it. Everything that reads it does so inside an animation
 * frame, where a subscription would be a slower way of asking the same question. The listeners exist
 * only so a panel can notice that a canvas appeared or went away.
 */

export interface ViewportView {
  width: number;
  height: number;
}

class ViewportStore {
  private viewport: Viewport | null = null;
  private view: ViewportView = { width: 0, height: 0 };
  private readonly listeners = new Set<() => void>();

  /** Called by the canvas on mount, and with null on unmount. */
  set(
    viewport: Viewport | null,
    view: ViewportView = { width: 0, height: 0 },
  ): void {
    this.viewport = viewport;
    this.view = view;
    for (const listener of this.listeners) listener();
  }

  /** The canvas reports its own size as the dock is dragged. */
  setView(view: ViewportView): void {
    this.view = view;
  }

  get(): Viewport | null {
    return this.viewport;
  }

  getView(): ViewportView {
    return this.view;
  }

  /** Notified when a canvas appears or goes away, not when the view moves. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  zoom(): number {
    return this.viewport?.zoom ?? 1;
  }

  /** Zooms about the middle of the view, which is what a button press should do. */
  setZoom(zoom: number): void {
    const viewport = this.viewport;
    if (viewport === null) return;
    viewport.setZoom(zoom, {
      x: this.view.width / 2,
      y: this.view.height / 2,
    });
  }

  panTo(point: Point): void {
    this.viewport?.panTo(point, this.view);
  }

  bounds(): {
    left: number;
    top: number;
    right: number;
    bottom: number;
  } | null {
    return this.viewport?.visibleBounds(this.view) ?? null;
  }

  /**
   * Frames a rectangle of the patch. What "zoom to fit" means.
   *
   * The rectangle is passed in rather than computed here: this store knows about a viewport and a
   * view size, and nothing about documents. The caller reads the patch.
   */
  fit(rect: { x: number; y: number; width: number; height: number }): void {
    this.viewport?.fit(rect, this.view);
  }
}

export const viewportStore = new ViewportStore();

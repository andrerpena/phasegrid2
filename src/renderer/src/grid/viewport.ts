import type { Container } from "pixi.js";
import type { Point } from "./layout";

/**
 * Pan and zoom, as a transform on one container.
 *
 * Deliberately small and hand-written rather than a plugin: the grid needs pan, zoom about the pointer,
 * and converting between screen and patch coordinates, and nothing else. Conversion is the part
 * everything depends on, because every hit test happens in patch coordinates while every event arrives
 * in screen ones.
 */

export const MIN_ZOOM = 0.15;
export const MAX_ZOOM = 4;

export class Viewport {
  x = 0;
  y = 0;
  zoom = 1;

  constructor(private readonly world: Container) {}

  /** Where a screen point lands in the patch. */
  toWorld(point: Point): Point {
    return {
      x: (point.x - this.x) / this.zoom,
      y: (point.y - this.y) / this.zoom,
    };
  }

  /** Where a patch point lands on screen. */
  toScreen(point: Point): Point {
    return { x: point.x * this.zoom + this.x, y: point.y * this.zoom + this.y };
  }

  panBy(dx: number, dy: number): void {
    this.x += dx;
    this.y += dy;
    this.commit();
  }

  /**
   * Zooms about a fixed screen point, so the patch under the pointer stays under the pointer.
   *
   * Zooming about the origin instead is the thing that makes a canvas feel broken: what you were
   * looking at slides away exactly when you are trying to look at it more closely.
   */
  zoomAt(screen: Point, factor: number): void {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
    if (next === this.zoom) return;
    const before = this.toWorld(screen);
    this.zoom = next;
    const after = this.toWorld(screen);
    this.x += (after.x - before.x) * this.zoom;
    this.y += (after.y - before.y) * this.zoom;
    this.commit();
  }

  setZoom(zoom: number, centre: Point): void {
    this.zoomAt(centre, zoom / this.zoom);
  }

  /** Frames a rectangle, with room around it. Used by "zoom to fit". */
  fit(
    bounds: { x: number; y: number; width: number; height: number },
    view: { width: number; height: number },
  ): void {
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const margin = 40;
    const scale = Math.min(
      (view.width - margin * 2) / bounds.width,
      (view.height - margin * 2) / bounds.height,
    );
    this.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
    this.x = view.width / 2 - (bounds.x + bounds.width / 2) * this.zoom;
    this.y = view.height / 2 - (bounds.y + bounds.height / 2) * this.zoom;
    this.commit();
  }

  private commit(): void {
    this.world.position.set(this.x, this.y);
    this.world.scale.set(this.zoom);
  }
}

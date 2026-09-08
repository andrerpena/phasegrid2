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
  private _x = 0;
  private _y = 0;
  private _zoom = 1;

  constructor(private readonly world: Container) {}

  /**
   * Accessors rather than fields, so setting one cannot leave the container out of step with it.
   *
   * They were plain fields, and assigning `zoom` directly changed every calculation that read it while
   * never touching the container's scale: the background redrew at the new zoom and the patch stayed
   * exactly where it was. Making the transform a consequence of the value rather than something a
   * caller has to remember to apply removes the whole class of that mistake.
   */
  get x(): number {
    return this._x;
  }
  set x(value: number) {
    this._x = value;
    this.commit();
  }

  get y(): number {
    return this._y;
  }
  set y(value: number) {
    this._y = value;
    this.commit();
  }

  get zoom(): number {
    return this._zoom;
  }
  set zoom(value: number) {
    this._zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
    this.commit();
  }

  /** Where a screen point lands in the patch. */
  toWorld(point: Point): Point {
    return {
      x: (point.x - this.x) / this.zoom,
      y: (point.y - this.y) / this.zoom,
    };
  }

  /** Where a patch point lands on screen. */
  toScreen(point: Point): Point {
    return {
      x: point.x * this._zoom + this._x,
      y: point.y * this._zoom + this._y,
    };
  }

  panBy(dx: number, dy: number): void {
    this._x += dx;
    this._y += dy;
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
    this._zoom = next;
    const after = this.toWorld(screen);
    this._x += (after.x - before.x) * this._zoom;
    this._y += (after.y - before.y) * this._zoom;
    this.commit();
  }

  setZoom(zoom: number, centre: Point): void {
    this.zoomAt(centre, zoom / this.zoom);
  }

  /** Centres a patch point in a view of the given size. What the minimap drives. */
  panTo(point: Point, view: { width: number; height: number }): void {
    this._x = view.width / 2 - point.x * this._zoom;
    this._y = view.height / 2 - point.y * this._zoom;
    this.commit();
  }

  /**
   * The patch rectangle currently on screen.
   *
   * The minimap draws this as the box you can drag, so it is the answer to "where am I" that
   * anything outside the canvas needs. Takes the view size rather than remembering one: the canvas
   * is resized by dragging the dock, and a remembered size would be stale exactly when the box
   * mattered.
   */
  visibleBounds(view: { width: number; height: number }): {
    left: number;
    top: number;
    right: number;
    bottom: number;
  } {
    return {
      left: -this._x / this._zoom,
      top: -this._y / this._zoom,
      right: (view.width - this._x) / this._zoom,
      bottom: (view.height - this._y) / this._zoom,
    };
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
    this._zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
    this._x = view.width / 2 - (bounds.x + bounds.width / 2) * this._zoom;
    this._y = view.height / 2 - (bounds.y + bounds.height / 2) * this._zoom;
    this.commit();
  }

  private commit(): void {
    this.world.position.set(this._x, this._y);
    this.world.scale.set(this._zoom);
  }
}

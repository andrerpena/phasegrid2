import { useCatalogStore } from "@renderer/catalog/catalog-store";
import { CELL } from "@renderer/grid/layout";
import {
  type PatchBounds,
  patchBounds,
  sameShape,
} from "@renderer/grid/patch-bounds";
import { viewportStore } from "@renderer/grid/viewport-store";
import { hexToRgb } from "@renderer/lib/color";
import { usePatchStore } from "@renderer/patch/patch-store";
import { useGridThemeStore } from "@renderer/theming/grid-theme-store";
import { Map as MapIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import type { WidgetDefinition } from "../types";
import { type MinimapBuffer, minimapDrawerRegistry, setCell } from "./minimap";

/**
 * The whole patch at a glance, and where you are in it.
 *
 * One pixel per grid cell, painted by whatever registered a drawer — the minimap knows nothing about
 * modules or cables, only that some things can colour a cell. Two buffers: a static one holding
 * everything that changes when you edit, and a dynamic one composed from it every frame for
 * anything that moves. Repainting the first at the second's rate is most of the cost of a naive
 * minimap.
 *
 * The white rectangle is the canvas's visible bounds. Dragging inside it moves the canvas; dragging
 * outside it moves the minimap's own view, which is what lets you look at one end of a large patch
 * while working at the other. The wheel zooms whichever of the two the cursor is over.
 */

const ZOOM_STEP = 1.15;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 32;
/**
 * How much of the panel the patch fills when fitted. Below one on purpose: the gap is what makes the
 * edge of the patch visible, so "there is nothing further that way" is something you can see.
 */
const FIT_FRACTION = 0.85;

interface Buffers {
  bounds: PatchBounds;
  staticBuffer: ImageData;
  frameBuffer: ImageData;
  /** Last value of each static drawer's key, so one only repaints when its own input changed. */
  keys: Map<string, unknown>;
}

/** Where the minimap is looking: display pixels per cell, and the cell at the panel's centre. */
interface Camera {
  zoom: number;
  centreX: number;
  centreY: number;
}

function fitZoom(bounds: PatchBounds, width: number, height: number): number {
  if (bounds.width === 0 || bounds.height === 0 || width === 0 || height === 0)
    return 1;
  return Math.min(width / bounds.width, height / bounds.height) * FIT_FRACTION;
}

function fill(buffer: MinimapBuffer, hex: string): void {
  const { r, g, b } = hexToRgb(hex);
  const data = buffer.data;
  for (let at = 0; at < data.length; at += 4) {
    data[at] = r;
    data[at + 1] = g;
    data[at + 2] = b;
    data[at + 3] = 255;
  }
}

const MiniMapView = () => {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const marker = useRef<HTMLDivElement>(null);
  const buffers = useRef<Buffers | null>(null);
  const camera = useRef<Camera>({ zoom: 1, centreX: 0, centreY: 0 });
  /** Panel size in CSS pixels, kept in a ref so the frame loop reads it without a render. */
  const size = useRef({ width: 0, height: 0 });
  /** Where the viewport rectangle was last drawn, so the pointer can tell inside from outside. */
  const lastMarker = useRef<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  /** Set once the camera has been fitted to a patch, so it is not refitted on every edit. */
  const fitted = useRef(false);

  useEffect(() => {
    const element = host.current;
    const surface = canvas.current;
    const box = marker.current;
    if (element === null || surface === null || box === null) return;
    const context = surface.getContext("2d");
    if (context === null) return;

    const measure = () => {
      const rect = element.getBoundingClientRect();
      size.current = { width: rect.width, height: rect.height };
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);

    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const panel = size.current;
      if (panel.width === 0 || panel.height === 0) return;

      const doc = usePatchStore.getState().doc;
      const catalog = useCatalogStore.getState().byId;
      const colors = useGridThemeStore.getState().colors;
      const bounds = patchBounds(doc, catalog);

      // Reallocated only when the patch's extent changes shape, which is rare -- moving a module
      // inside the existing bounds keeps the same buffer.
      if (!sameShape(buffers.current?.bounds ?? null, bounds)) {
        buffers.current = {
          bounds,
          staticBuffer: new ImageData(bounds.width, bounds.height),
          frameBuffer: new ImageData(bounds.width, bounds.height),
          keys: new Map(),
        };
        if (!fitted.current && doc.modules.length > 0) {
          camera.current = {
            zoom: fitZoom(bounds, panel.width, panel.height),
            centreX: bounds.originX + bounds.width / 2,
            centreY: bounds.originY + bounds.height / 2,
          };
          fitted.current = true;
        }
      }
      const held = buffers.current;
      if (held === null) return;

      const drawers = minimapDrawerRegistry.all();
      const paintInto =
        (buffer: ImageData) =>
        (x: number, y: number, r: number, g: number, b: number) =>
          setCell(buffer, held.bounds, x, y, r, g, b);

      // 1. The static layer, if anything it watches moved.
      let stale = held.keys.size === 0;
      for (const drawer of drawers) {
        if (drawer.layer !== "static" || drawer.staticKey === undefined)
          continue;
        const key = drawer.staticKey(doc);
        if (held.keys.get(drawer.id) !== key) {
          held.keys.set(drawer.id, key);
          stale = true;
        }
      }
      if (stale) {
        fill(held.staticBuffer, colors.background);
        for (const drawer of drawers) {
          if (drawer.layer !== "static") continue;
          drawer.draw({
            paint: paintInto(held.staticBuffer),
            doc,
            catalog,
            colors,
            bounds: held.bounds,
          });
        }
      }

      // 2. The frame: the static layer, plus anything that moves.
      held.frameBuffer.data.set(held.staticBuffer.data);
      for (const drawer of drawers) {
        if (drawer.layer !== "dynamic") continue;
        drawer.draw({
          paint: paintInto(held.frameBuffer),
          doc,
          catalog,
          colors,
          bounds: held.bounds,
        });
      }

      // 3. Blit at one pixel per cell; CSS scales and positions it.
      if (surface.width !== held.bounds.width)
        surface.width = held.bounds.width;
      if (surface.height !== held.bounds.height)
        surface.height = held.bounds.height;
      context.putImageData(held.frameBuffer, 0, 0);

      const view = camera.current;
      const offsetX =
        panel.width / 2 - (view.centreX - held.bounds.originX) * view.zoom;
      const offsetY =
        panel.height / 2 - (view.centreY - held.bounds.originY) * view.zoom;
      surface.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${view.zoom})`;

      // 4. The canvas's visible rectangle, in the same coordinates.
      const visible = viewportStore.bounds();
      if (visible === null) {
        box.style.display = "none";
        lastMarker.current = null;
        return;
      }
      const left =
        (visible.left / CELL - held.bounds.originX) * view.zoom + offsetX;
      const top =
        (visible.top / CELL - held.bounds.originY) * view.zoom + offsetY;
      const width = ((visible.right - visible.left) / CELL) * view.zoom;
      const height = ((visible.bottom - visible.top) / CELL) * view.zoom;
      box.style.display = "block";
      box.style.left = `${left}px`;
      box.style.top = `${top}px`;
      box.style.width = `${width}px`;
      box.style.height = `${height}px`;
      lastMarker.current = { left, top, width, height };
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  // Pointer and wheel, on the panel rather than the canvas: the canvas is transformed, and hit
  // testing against a scaled element is arithmetic you have to undo anyway.
  useEffect(() => {
    const element = host.current;
    if (element === null) return;

    /** Panel pixels to patch cells, and back to panel pixels for the hit test. */
    const locate = (clientX: number, clientY: number) => {
      const rect = element.getBoundingClientRect();
      const panel = size.current;
      const view = camera.current;
      const bounds = buffers.current?.bounds;
      const panelX = clientX - rect.left;
      const panelY = clientY - rect.top;
      if (bounds === undefined) return { cellX: 0, cellY: 0, panelX, panelY };
      const offsetX =
        panel.width / 2 - (view.centreX - bounds.originX) * view.zoom;
      const offsetY =
        panel.height / 2 - (view.centreY - bounds.originY) * view.zoom;
      return {
        cellX: (panelX - offsetX) / view.zoom + bounds.originX,
        cellY: (panelY - offsetY) / view.zoom + bounds.originY,
        panelX,
        panelY,
      };
    };

    const insideMarker = (panelX: number, panelY: number) => {
      const at = lastMarker.current;
      if (at === null) return false;
      return (
        panelX >= at.left &&
        panelX <= at.left + at.width &&
        panelY >= at.top &&
        panelY <= at.top + at.height
      );
    };

    let dragging: "canvas" | "map" | null = null;
    let lastX = 0;
    let lastY = 0;

    const onPointerDown = (event: PointerEvent) => {
      const at = locate(event.clientX, event.clientY);
      dragging = insideMarker(at.panelX, at.panelY) ? "canvas" : "map";
      lastX = event.clientX;
      lastY = event.clientY;
      element.setPointerCapture(event.pointerId);
      // A click outside the rectangle takes you there; a drag inside it carries it.
      if (dragging === "map")
        viewportStore.panTo({ x: at.cellX * CELL, y: at.cellY * CELL });
    };

    const onPointerMove = (event: PointerEvent) => {
      if (dragging === null) return;
      if (dragging === "canvas") {
        const at = locate(event.clientX, event.clientY);
        viewportStore.panTo({ x: at.cellX * CELL, y: at.cellY * CELL });
        return;
      }
      // Dragging the map moves its camera against the cursor, so the patch feels grabbed.
      const view = camera.current;
      camera.current = {
        ...view,
        centreX: view.centreX - (event.clientX - lastX) / view.zoom,
        centreY: view.centreY - (event.clientY - lastY) / view.zoom,
      };
      lastX = event.clientX;
      lastY = event.clientY;
    };

    const onPointerUp = (event: PointerEvent) => {
      dragging = null;
      if (element.hasPointerCapture(event.pointerId))
        element.releasePointerCapture(event.pointerId);
    };

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const at = locate(event.clientX, event.clientY);
      const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;

      // Over the rectangle, the wheel is about the canvas -- which is what you meant if you were
      // looking at it.
      if (insideMarker(at.panelX, at.panelY)) {
        viewportStore.setZoom(viewportStore.zoom() * factor);
        return;
      }

      const view = camera.current;
      const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, view.zoom * factor));
      if (zoom === view.zoom) return;
      const panel = size.current;
      // Anchored on the cursor: the cell under it stays under it.
      camera.current = {
        zoom,
        centreX: at.cellX + (panel.width / 2 - at.panelX) / zoom,
        centreY: at.cellY + (panel.height / 2 - at.panelY) / zoom,
      };
    };

    const onDoubleClick = () => {
      const bounds = buffers.current?.bounds;
      if (bounds === undefined) return;
      const panel = size.current;
      camera.current = {
        zoom: fitZoom(bounds, panel.width, panel.height),
        centreX: bounds.originX + bounds.width / 2,
        centreY: bounds.originY + bounds.height / 2,
      };
    };

    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerup", onPointerUp);
    element.addEventListener("pointercancel", onPointerUp);
    element.addEventListener("wheel", onWheel, { passive: false });
    element.addEventListener("dblclick", onDoubleClick);
    return () => {
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", onPointerUp);
      element.removeEventListener("pointercancel", onPointerUp);
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("dblclick", onDoubleClick);
    };
  }, []);

  return (
    <div
      ref={host}
      // Darker than the patch's own ground, so the edge of the patch is visible without a border.
      className="relative h-full w-full cursor-crosshair overflow-hidden bg-black touch-none"
      data-testid="mini-map"
    >
      <canvas
        ref={canvas}
        className="absolute left-0 top-0 origin-top-left [image-rendering:pixelated]"
      />
      <div
        ref={marker}
        className="pointer-events-none absolute box-border hidden border border-foreground/70"
      />
    </div>
  );
};

export const miniMapWidget: WidgetDefinition = {
  id: "mini-map",
  label: "Mini-Map",
  icon: MapIcon,
  component: MiniMapView,
  defaultSlot: "right-top",
  scrollable: false,
  scope: "mini-map",
};

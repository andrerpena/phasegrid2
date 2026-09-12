import { useCatalogStore } from "@renderer/catalog/catalog-store";
import { patchRect } from "@renderer/grid/patch-bounds";
import { MAX_ZOOM, MIN_ZOOM } from "@renderer/grid/viewport";
import { viewportStore } from "@renderer/grid/viewport-store";
import { usePatchStore } from "@renderer/patch/patch-store";
import { Minus, Plus, Scan } from "lucide-react";
import { useEffect, useState } from "react";
import type { ControlBarDefinition, ControlBarProps } from "../types";

const STEP = 1.25;

/**
 * Zoom, as a number you can read and three buttons.
 *
 * Worth having even with a wheel and a pinch: it is the only place the current zoom is written down,
 * and "what am I actually at" is the question you ask right before you decide to reset.
 *
 * The reading is polled rather than subscribed to. Zoom changes inside an animation frame on a
 * gesture, and a store notification per frame would re-render React sixty times a second to update
 * two digits; five times a second is indistinguishable and costs nothing.
 */
const ZoomControlBarComponent = (_props: ControlBarProps) => {
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const timer = setInterval(() => setZoom(viewportStore.zoom()), 200);
    return () => clearInterval(timer);
  }, []);

  const button =
    "flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground";

  return (
    <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-background/80 px-1.5 py-1 shadow-lg backdrop-blur-sm">
      <button
        type="button"
        className={button}
        title="Zoom out"
        aria-label="Zoom out"
        onClick={() => viewportStore.setZoom(Math.max(MIN_ZOOM, zoom / STEP))}
      >
        <Minus size={13} />
      </button>
      {/* A live region: the number changes as you pinch, without anyone pressing anything. */}
      <output
        className="min-w-11 text-center text-xs tabular-nums text-foreground/80"
        aria-label="Zoom"
      >
        {Math.round(zoom * 100)}%
      </output>
      <button
        type="button"
        className={button}
        title="Zoom in"
        aria-label="Zoom in"
        onClick={() => viewportStore.setZoom(Math.min(MAX_ZOOM, zoom * STEP))}
      >
        <Plus size={13} />
      </button>
      <button
        type="button"
        className={button}
        title="Zoom to fit"
        aria-label="Zoom to fit"
        onClick={() =>
          viewportStore.fit(
            patchRect(
              usePatchStore.getState().doc,
              useCatalogStore.getState().byId,
            ),
          )
        }
      >
        <Scan size={13} />
      </button>
    </div>
  );
};

export const zoomControlBar: ControlBarDefinition = {
  id: "zoom-control",
  component: ZoomControlBarComponent,
  defaultPosition: "right-top",
};

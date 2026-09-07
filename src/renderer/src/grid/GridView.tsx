import { useCatalogStore } from "@renderer/catalog/catalog-store";
import { usePatchStore } from "@renderer/patch/patch-store";
import { useThemeStore } from "@renderer/theming/theme-store";
import { Application } from "pixi.js";
// Pixi compiles its shaders with `Function` by default, which the renderer's content policy forbids.
// This module swaps in an interpreted path. Without it the application never initialises and the only
// symptom is a canvas that never appears.
import "pixi.js/unsafe-eval";
import { useEffect, useRef } from "react";
import { GridRenderer } from "./GridRenderer";
import styles from "./GridView.module.css";
import {
  beginDragNodes,
  beginMarquee,
  beginPan,
  IDLE,
  type Interaction,
  pointerMove,
  pointerUp,
} from "./interaction";
import { snap } from "./layout";

/**
 * React's entire involvement with the canvas: create it, hand it to the renderer, destroy it.
 *
 * Everything inside is imperative. Subscribing to the stores directly rather than re-rendering means a
 * drag moves nodes without React seeing a single one of the frames.
 */
export const GridView = () => {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Guards against the async gap: React can unmount before `init` resolves, and without this the
    // canvas is appended to an element that is no longer in the document and never destroyed.
    let cancelled = false;
    let app: Application | null = null;
    let renderer: GridRenderer | null = null;
    let stopPatch: (() => void) | null = null;
    let stopTheme: (() => void) | null = null;
    let stopCatalog: (() => void) | null = null;
    let observer: ResizeObserver | null = null;

    const setup = async () => {
      const element = host.current;
      if (element === null) return;
      const created = new Application();
      await created.init({
        resizeTo: element,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: window.devicePixelRatio,
      });
      if (cancelled) {
        created.destroy(true, { children: true });
        return;
      }
      app = created;
      element.appendChild(created.canvas);

      const theme = useThemeStore.getState().theme;
      // A local const as well as the outer binding: the handlers below all run while this renderer is
      // alive, so capturing it here is what lets them use it without asserting it is not null at every
      // single call.
      const view = new GridRenderer(
        created,
        theme,
        useCatalogStore.getState().byId,
      );
      renderer = view;
      view.sync(usePatchStore.getState().doc);

      stopPatch = usePatchStore.subscribe((state) => renderer?.sync(state.doc));
      stopTheme = useThemeStore.subscribe((state) =>
        renderer?.setTheme(state.theme),
      );
      // The catalogue arrives after the engine handshake, which is after this runs. Without this the
      // renderer keeps the empty map it was built with and silently draws nothing: every module in the
      // patch looks like a type it has never heard of.
      stopCatalog = useCatalogStore.subscribe((state) => {
        renderer?.setCatalog(state.byId);
        renderer?.sync(usePatchStore.getState().doc);
      });

      observer = new ResizeObserver(() => renderer?.drawBackground());
      observer.observe(element);

      let interaction: Interaction = IDLE;
      const dragStart = new Map<string, { x: number; y: number }>();

      const worldPoint = (event: PointerEvent) => {
        const box = created.canvas.getBoundingClientRect();
        return view.viewport.toWorld({
          x: event.clientX - box.left,
          y: event.clientY - box.top,
        });
      };

      created.canvas.addEventListener("pointerdown", (event) => {
        const point = worldPoint(event);
        // Middle button or space-drag pans; that is the convention everywhere and muscle memory is
        // worth more than any argument for a different one.
        if (event.button === 1) {
          interaction = beginPan({ x: event.clientX, y: event.clientY });
          return;
        }
        const hit = view.nodeAt(point);
        if (hit !== null) {
          interaction = beginDragNodes([hit.id], point);
          dragStart.clear();
          const doc = usePatchStore.getState().doc;
          for (const module of doc.modules)
            if (module.id === hit.id)
              dragStart.set(module.id, { x: module.x ?? 0, y: module.y ?? 0 });
          view.setSelection(new Set([hit.id]));
          return;
        }
        interaction = beginMarquee(point, event.shiftKey);
        view.setSelection(new Set());
      });

      window.addEventListener("pointermove", (event) => {
        if (interaction.kind === "idle") return;
        if (interaction.kind === "panning") {
          const result = pointerMove(interaction, {
            x: event.clientX,
            y: event.clientY,
          });
          interaction = result.next;
          if (result.pan !== undefined)
            view.viewport.panBy(result.pan.x, result.pan.y);
          view.drawBackground();
          return;
        }
        const point = worldPoint(event);
        const result = pointerMove(interaction, point);
        interaction = result.next;
        if (interaction.kind === "dragNodes" && interaction.moved) {
          const dx = interaction.last.x - interaction.start.x;
          const dy = interaction.last.y - interaction.start.y;
          // Moved live without recording anything: the undo entry is written once, on release.
          usePatchStore.getState().apply(
            interaction.ids.flatMap((id) => {
              const from = dragStart.get(id);
              return from === undefined
                ? []
                : [
                    {
                      op: "moduleMove" as const,
                      id,
                      x: snap(from.x + dx, 8),
                      y: snap(from.y + dy, 8),
                    },
                  ];
            }),
          );
        }
        if (interaction.kind === "marquee") {
          view.drawOverlay(
            {
              x: Math.min(interaction.start.x, interaction.current.x),
              y: Math.min(interaction.start.y, interaction.current.y),
              width: Math.abs(interaction.start.x - interaction.current.x),
              height: Math.abs(interaction.start.y - interaction.current.y),
            },
            null,
          );
        }
      });

      window.addEventListener("pointerup", (event) => {
        if (interaction.kind === "idle") return;
        const end = pointerUp(interaction, worldPoint(event));
        interaction = end.next;
        view.drawOverlay(null, null);
        if (end.marquee !== undefined) {
          const selected = new Set<string>();
          for (const [id, node] of view.allNodes()) {
            const r = end.marquee.rect;
            const nx = node.view.position.x;
            const ny = node.view.position.y;
            if (
              nx < r.x + r.width &&
              nx + node.layout.width > r.x &&
              ny < r.y + r.height &&
              ny + node.layout.height > r.y
            )
              selected.add(id);
          }
          view.setSelection(selected);
        }
      });

      created.canvas.addEventListener("wheel", (event) => {
        event.preventDefault();
        const box = created.canvas.getBoundingClientRect();
        view.viewport.zoomAt(
          { x: event.clientX - box.left, y: event.clientY - box.top },
          event.deltaY < 0 ? 1.1 : 1 / 1.1,
        );
        view.drawBackground();
      });
    };

    void setup();

    return () => {
      cancelled = true;
      stopPatch?.();
      stopTheme?.();
      stopCatalog?.();
      observer?.disconnect();
      renderer?.destroy();
      app?.destroy(true, { children: true });
    };
  }, []);

  return <div ref={host} className={styles.host} data-kb-scope="grid" />;
};

import { useCatalogStore } from "@renderer/catalog/catalog-store";
import { sendTransientParam } from "@renderer/patch/engine-sync";
import { usePatchStore } from "@renderer/patch/patch-store";
import { useProjectStore } from "@renderer/project/project-store";
import { useThemeStore } from "@renderer/theming/theme-store";
import type { PatchOp } from "@shared/protocol/patch";
import { Application } from "pixi.js";
// Pixi compiles its shaders with `Function` by default, which the renderer's content policy forbids.
// This module swaps in an interpreted path. Without it the application never initialises and the only
// symptom is a canvas that never appears.
import "pixi.js/unsafe-eval";
import { useEffect, useRef } from "react";
import { GridInteraction } from "./GridInteraction";
import { GridRenderer } from "./GridRenderer";
import styles from "./GridView.module.css";

/**
 * React's entire involvement with the canvas: create it, hand it to the renderer, destroy it.
 *
 * The drawing and the pointer handling live outside React, subscribing to the stores directly, so a
 * drag moves nodes without React seeing a single one of the frames. What is left here is the part React
 * is actually good at: owning an element's lifetime.
 */
export const GridView = () => {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Guards the async gap: React can unmount before `init` resolves, and without this the canvas is
    // appended to an element no longer in the document and never destroyed.
    let cancelled = false;
    let app: Application | null = null;
    let renderer: GridRenderer | null = null;
    const stop: (() => void)[] = [];

    const setup = async () => {
      const element = host.current;
      if (element === null) return;
      const created = new Application();
      await created.init({
        resizeTo: element,
        backgroundAlpha: 0,
        // WebGL rather than letting Pixi choose. Its WebGPU path fails to acquire a context in some
        // Electron configurations and the only symptom is a canvas that never appears; WebGL is
        // available everywhere this runs and is more than enough for two dimensions of flat shapes.
        preference: "webgl",
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

      const view = new GridRenderer(
        created,
        useThemeStore.getState().theme,
        useCatalogStore.getState().byId,
      );
      renderer = view;
      view.sync(usePatchStore.getState().doc);

      stop.push(usePatchStore.subscribe((state) => view.sync(state.doc)));
      stop.push(useThemeStore.subscribe((state) => view.setTheme(state.theme)));
      // The catalogue arrives after the engine handshake, which is after this runs. Without this the
      // renderer keeps the empty map it was built with and silently draws nothing: every module in the
      // patch looks like a type it has never heard of.
      stop.push(
        useCatalogStore.subscribe((state) => {
          view.setCatalog(state.byId);
          view.sync(usePatchStore.getState().doc);
        }),
      );

      const observer = new ResizeObserver(() => view.drawBackground());
      observer.observe(element);
      stop.push(() => observer.disconnect());

      const interaction = new GridInteraction(
        view,
        created.canvas,
        {
          onNodesMoved: (moves) => {
            usePatchStore.getState().apply(
              moves.map(
                (m): PatchOp => ({
                  op: "moduleMove",
                  id: m.id,
                  x: m.x,
                  y: m.y,
                }),
              ),
              {
                label:
                  moves.length > 1
                    ? `Move ${moves.length} modules`
                    : "Move module",
              },
            );
          },
          onParamChange: (module, param, value, done) => {
            // While the knob is moving, the value goes to the engine and nowhere else, so the sound
            // follows the pointer. The document is written once, on release: one undo entry for the
            // gesture, and undo returns to where the knob was before it started, not to the last frame.
            if (!done) {
              sendTransientParam(module, param, value);
              return;
            }
            usePatchStore
              .getState()
              .apply([{ op: "paramSet", module, param, value }], {
                label: "Set parameter",
              });
          },
        },
        // An example demonstrates a module: its wiring is fixed and its knobs are live. Read once,
        // when the canvas is built, because a project's kind never changes while it is open.
        {
          parametersOnly:
            useProjectStore.getState().active()?.kind === "example",
        },
      );
      stop.push(interaction.attach());
    };

    void setup();

    return () => {
      cancelled = true;
      for (const off of stop) off();
      renderer?.destroy();
      app?.destroy(true, { children: true });
    };
  }, []);

  return <div ref={host} className={styles.host} data-kb-scope="grid" />;
};

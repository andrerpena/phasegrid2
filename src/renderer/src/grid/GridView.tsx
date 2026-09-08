import { useCatalogStore } from "@renderer/catalog/catalog-store";
import { uniqueEdgeId } from "@renderer/patch/add-module";
import { paramValue } from "@renderer/patch/params";
import { usePatchStore } from "@renderer/patch/patch-store";
import { useProjectStore } from "@renderer/project/project-store";
import { useThemeStore } from "@renderer/theming/theme-store";
import type { PatchOp } from "@shared/protocol/patch";
import { Application } from "pixi.js";
// Pixi compiles its shaders with `Function` by default, which the renderer's content policy forbids.
// This module swaps in an interpreted path. Without it the application never initialises and the only
// symptom is a canvas that never appears.
import "pixi.js/unsafe-eval";
import { useSelectionStore } from "@renderer/selection/selection-store";
import { useEffect, useRef } from "react";
import { GridInteraction } from "./GridInteraction";
import { GridRenderer } from "./GridRenderer";
import { startPreviewSync } from "./preview-sync";
import { startTelemetrySync } from "./telemetry-sync";

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

      // The wave panels: filled by the engine, asked for whenever they may have gone stale.
      const preview = startPreviewSync({
        previewing: () => view.previewing(),
        setPreview: (id, samples) => view.setPreview(id, samples),
      });
      stop.push(preview.stop);
      preview.refreshAll();

      // The knobs something is modulating, and every wave panel: read from the engine's segment on
      // every frame the canvas draws, so a knob turns and a face redraws as the sound does rather
      // than sitting on the document's values while it moves.
      const telemetry = startTelemetrySync(
        {
          setLive: (id, param, fraction) => view.setLive(id, param, fraction),
          setWave: (id, samples) => view.setPreview(id, samples),
        },
        (tick) => {
          created.ticker.add(tick);
          return () => created.ticker.remove(tick);
        },
      );
      stop.push(telemetry.stop);

      stop.push(usePatchStore.subscribe((state) => view.sync(state.doc)));
      stop.push(useThemeStore.subscribe((state) => view.setTheme(state.theme)));
      // The catalogue arrives after the engine handshake, which is after this runs. Without this the
      // renderer keeps the empty map it was built with and silently draws nothing: every module in the
      // patch looks like a type it has never heard of. The panels are asked for again for the same
      // reason: until the catalogue is here there are no nodes to put a picture on.
      stop.push(
        useCatalogStore.subscribe((state) => {
          view.setCatalog(state.byId);
          view.sync(usePatchStore.getState().doc);
          preview.refreshAll();
        }),
      );

      const observer = new ResizeObserver(() => view.drawBackground());
      observer.observe(element);
      stop.push(() => observer.disconnect());

      const interaction = new GridInteraction(
        view,
        created.canvas,
        {
          // The selection is made here and acted on elsewhere: a keybinding cannot ask a Pixi class
          // what is selected, and neither can a command.
          onSelectionChanged: (ids) => useSelectionStore.getState().set(ids),
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
          // Cables, like values, are read from the document and nowhere else.
          readEdgesInto: (module, port) =>
            usePatchStore
              .getState()
              .doc.edges.filter(
                (e) => e.to.module === module && e.to.port === port,
              )
              .map((e) => ({ id: e.id, from: e.from })),
          // A cable made or moved is one edit: the removal of what it was and the addition of what
          // it is, so undo takes the whole gesture back. Engine sync sends both in one batch.
          onConnect: (from, to, { replaces }) => {
            const store = usePatchStore.getState();
            const ops: PatchOp[] = [];
            if (replaces !== undefined)
              ops.push({ op: "edgeRemove", id: replaces });
            ops.push({ op: "edgeAdd", id: uniqueEdgeId(store.doc), from, to });
            store.apply(ops, {
              label: replaces === undefined ? "Connect" : "Move cable",
            });
          },
          onDisconnect: (id) => {
            usePatchStore
              .getState()
              .apply([{ op: "edgeRemove", id }], { label: "Disconnect" });
          },
          // The one place a parameter value is read from: the document, through the accessor everything
          // else uses. Nothing on the canvas keeps a copy to answer with.
          readParam: (module, param) => {
            const doc = usePatchStore.getState().doc;
            const found = doc.modules.find((m) => m.id === module);
            const descriptor = useCatalogStore
              .getState()
              .byId.get(found?.type ?? "");
            return descriptor === undefined
              ? 0
              : paramValue(found, descriptor, param);
          },
          onParamChange: ({ module, param, value, done, previous }) => {
            // Every value goes to the document, including the ones passing under a moving hand: it is
            // the only place a parameter value lives, and everything that draws one reads it from
            // there. Engine sync and the wave panels are watching the same stream, so neither is told
            // anything here.
            //
            // Only the release is labelled, so the gesture is one step back rather than a hundred, and
            // it carries its own inverse because the document no longer remembers where the knob was
            // when the hand went down.
            usePatchStore.getState().apply(
              [
                {
                  op: "paramSet",
                  module,
                  param,
                  value,
                  ...(done ? {} : { transient: true }),
                },
              ],
              done
                ? {
                    label: "Set parameter",
                    inverse: [
                      { op: "paramSet", module, param, value: previous },
                    ],
                  }
                : {},
            );
          },
        },
        // An example demonstrates a module: its wiring is fixed and its knobs are live. Asked each
        // time rather than read once, because saving an example makes it a project of the user's own
        // and the canvas is not rebuilt for that — the tab is the same tab.
        {
          parametersOnly: () =>
            useProjectStore.getState().active()?.kind === "example",
        },
      );
      stop.push(interaction.attach());
    };

    void setup();

    return () => {
      cancelled = true;
      // The canvas is rebuilt per project, so a selection outliving it would be a set of ids belonging
      // to a patch nobody is looking at — and Delete would act on them.
      useSelectionStore.getState().clear();
      for (const off of stop) off();
      renderer?.destroy();
      app?.destroy(true, { children: true });
    };
  }, []);

  // Focusable, and focused when it is clicked, so that `data-kb-scope="grid"` resolves to anything.
  // The scope is read from the focused element's nearest declaring ancestor, and a canvas cannot hold
  // focus, so before this a binding scoped to the grid could never match.
  return (
    <div
      ref={host}
      // The canvas fills this; the element itself only ever provides the box and the focus scope.
      className="absolute inset-0 overflow-hidden touch-none [&>canvas]:block"
      data-kb-scope="grid"
      tabIndex={-1}
      onPointerDown={() => host.current?.focus()}
    />
  );
};

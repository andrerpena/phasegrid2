import { useEngineStore } from "@renderer/engine/engine-store";
import { afterSync } from "@renderer/patch/engine-sync";
import { usePatchStore } from "@renderer/patch/patch-store";

/**
 * Keeps the wave panels on the canvas showing what the engine would play, for an engine that does
 * not publish its pictures. One that does (the `previews` capability) is read by `telemetry-sync.ts`
 * live, and this asks for nothing.
 *
 * A module that can draw itself says so in the catalogue, and the picture is computed by the module
 * from the same parameters the sound is. Nothing here knows what any waveform looks like; it only knows
 * when a picture may have gone stale and asks for a fresh one: when a parameter changes, when a module
 * appears, when a project opens, and when the engine restarts.
 *
 * Requests ride the same serial queue as document edits (`afterSync`), so a picture is always asked
 * for after the edit that changed it has reached the engine, and never for a module the engine has not
 * been told about yet.
 */

export interface PreviewTarget {
  /**
   * Ids of the modules drawn right now that have a WAVE panel to fill.
   *
   * Only a wave: this path answers `module.preview` with a plain array of samples, and an envelope's
   * picture is a header and a curve that has to be decoded. An engine old enough to need this path is
   * an engine with no telemetry segment at all, where the meters, the scopes and the modulated knobs
   * are dead too, so an envelope drawn from the document there is not the thing to fix first.
   */
  previewing(): string[];
  setPreview(moduleId: string, samples: ArrayLike<number>): void;
}

export interface PreviewSync {
  /** A module's picture may be stale: fetch it again. Safe to call at frame rate. */
  refresh(moduleId: string): void;
  refreshAll(): void;
  stop(): void;
}

/** Points per panel. A panel is forty-odd pixels wide; more than this buys nothing on screen. */
const PREVIEW_COUNT = 128;

export function startPreviewSync(target: PreviewTarget): PreviewSync {
  // One request in flight per module, and at most one more waiting behind it. A knob dragged at sixty
  // frames a second would otherwise queue sixty requests, and the panel would keep updating for a
  // second after the hand had stopped. Latest wins: what the panel shows is where the knob is now.
  const inFlight = new Set<string>();
  const wanted = new Set<string>();
  let stopped = false;

  const fetch = (moduleId: string): void => {
    inFlight.add(moduleId);
    afterSync(async () => {
      if (stopped) {
        inFlight.delete(moduleId);
        return;
      }
      try {
        const { samples } = await useEngineStore
          .getState()
          .call("module.preview", { module: moduleId, count: PREVIEW_COUNT });
        if (!stopped) target.setPreview(moduleId, samples);
      } catch {
        // A module removed between the ask and the answer, or one that cannot draw. Either way there is
        // nothing to put on the panel, and nothing to resend.
      } finally {
        inFlight.delete(moduleId);
        if (wanted.delete(moduleId) && !stopped) fetch(moduleId);
      }
    });
  };

  const refresh = (moduleId: string): void => {
    if (stopped) return;
    // An engine that publishes every picture itself, live, is not asked as well: the answer would
    // paint the document's shape over the running one for a frame. This path is the fallback, and
    // the engine says whether it is needed; a segment alone does not, since an older engine has one
    // and no pictures.
    if (useEngineStore.getState().capabilities.includes("previews")) return;
    // Only a module with a panel is asked. Asking any other gets a refusal, and a refused call is
    // shown in the status bar as an engine error, which it is not.
    if (!target.previewing().includes(moduleId)) return;
    if (inFlight.has(moduleId)) wanted.add(moduleId);
    else fetch(moduleId);
  };
  const refreshAll = (): void => {
    for (const id of target.previewing()) refresh(id);
  };

  const stopOps = usePatchStore.getState().subscribeOps((ops, source) => {
    if (source === "load") {
      refreshAll();
      return;
    }
    for (const op of ops) {
      if (op.op === "paramSet") refresh(op.module);
      else if (op.op === "moduleAdd") refresh(op.id);
    }
  });
  const stopEvents = window.engine.onEvent((event) => {
    if (event.event === "engine.ready") refreshAll();
  });

  return {
    refresh,
    refreshAll,
    stop: () => {
      stopped = true;
      stopOps();
      stopEvents();
    },
  };
}

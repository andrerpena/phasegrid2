import { useCatalogStore } from "@renderer/catalog/catalog-store";
import { useEngineStore } from "@renderer/engine/engine-store";
import { afterSync } from "@renderer/patch/engine-sync";
import { usePatchStore } from "@renderer/patch/patch-store";
import type { ModuleDescriptor, ParamDesc } from "@shared/protocol/catalog";
import type { PatchDoc } from "@shared/protocol/patch";
import { TelemetryKind } from "@shared/protocol/telemetry";
import { paramFraction } from "./layout";

/**
 * Keeps the knobs on the canvas turning with what the engine is doing to them.
 *
 * A knob with a cable in its modulation socket is not where the document says it is; it is where
 * the signal on that cable has put it, which changes every block. The engine publishes that value
 * for any module it has been asked to watch, into shared memory, and this reads it back at frame
 * rate and hands it to the node as a *live* value, kept apart from the document's: the document is
 * what a drag edits and what the notch shows, and nothing here ever writes to it.
 *
 * The faces come the same way: every module with a wave panel is asked for its picture, which the
 * engine redraws from those same running values whenever they move, so a panel follows the sound
 * under modulation exactly as a knob does. The request-per-edit path (`preview-sync.ts`) is only for
 * an engine with no segment.
 *
 * And the display modules: one that publishes a scope or a readout writes that itself, into the slot
 * the engine gives any watched module, so it is asked for by name in the same list as the modulated
 * ones and its slot is read by the kind it carries rather than as knob values.
 *
 * This is the one owner of the engine's subscription set. `telemetry.subscribe` replaces the whole
 * set on every call, so a second subscriber elsewhere would silently cancel this one; when meters
 * arrive they add their modules here.
 */

export interface TelemetryTarget {
  setLive(moduleId: string, paramId: string, fraction: number | null): void;
  /** A module's picture, one cycle -1..1, as the engine drew it for the values it is running with. */
  setWave(moduleId: string, samples: ArrayLike<number>): void;
  /** The window on the wire into a scope module, one array per channel, and the engine's count of it. */
  setTrace(
    moduleId: string,
    index: bigint,
    channels: ArrayLike<number>[],
  ): void;
  /** The last value on the wire into a readout module, per channel, and the engine's count of it. */
  setValue(moduleId: string, index: bigint, values: number[]): void;
  /** The level on the wire into a meter module, and the engine's count of it. */
  setLevel(
    moduleId: string,
    index: bigint,
    level: { peak: number[]; rms: number[]; clipped: number[] },
  ): void;
}

export interface TelemetrySync {
  stop(): void;
}

/** One knob to keep live: which param, and its place in the engine's value list. */
interface LiveParam {
  param: ParamDesc;
  index: number;
}

/**
 * The modules with something plugged into a modulation socket, and which of their params it is.
 *
 * Only those are worth a slot: a module nothing modulates would publish its knobs back to itself.
 * Pure over the document and the catalogue, so it can be checked without an engine.
 */
export function modulatedModules(
  doc: PatchDoc,
  catalog: Map<string, ModuleDescriptor>,
): Map<string, LiveParam[]> {
  const out = new Map<string, LiveParam[]>();
  for (const edge of doc.edges) {
    const module = doc.modules.find((m) => m.id === edge.to.module);
    const descriptor =
      module === undefined ? undefined : catalog.get(module.type);
    if (descriptor === undefined) continue;
    const port = descriptor.inputs.find((p) => p.id === edge.to.port);
    if (port === undefined || !port.implicit || port.param === undefined)
      continue;
    const index = descriptor.params.findIndex((p) => p.id === port.param);
    if (index < 0) continue;
    const list = out.get(edge.to.module) ?? [];
    if (!list.some((l) => l.index === index))
      list.push({ param: descriptor.params[index], index });
    out.set(edge.to.module, list);
  }
  return out;
}

/**
 * The modules that publish something of their own onto their face -- a scope's window, a readout's
 * value, a meter's level. Every one of them is watched, cabled or not: what it shows is what it is for.
 *
 * One list rather than one per kind, because the slot says which kind it carries and the reader
 * dispatches on that. A new display module is a flag here and a case in the tick.
 */
export function displayModules(
  doc: PatchDoc,
  catalog: Map<string, ModuleDescriptor>,
): string[] {
  return doc.modules
    .filter((m) => {
      const flags = catalog.get(m.type)?.flags;
      return (
        flags?.publishesScope === true ||
        flags?.publishesValue === true ||
        flags?.publishesMeter === true
      );
    })
    .map((m) => m.id)
    .sort();
}

/** The modules whose face has a wave panel: every one of them is asked for its picture. */
export function previewedModules(
  doc: PatchDoc,
  catalog: Map<string, ModuleDescriptor>,
): string[] {
  return doc.modules
    .filter((m) => catalog.get(m.type)?.flags.previewsWave === true)
    .map((m) => m.id)
    .sort();
}

/**
 * `schedule` runs `tick` once per frame and returns how to stop; the canvas passes its ticker, a
 * test calls the tick itself.
 */
export function startTelemetrySync(
  target: TelemetryTarget,
  schedule: (tick: () => void) => () => void,
): TelemetrySync {
  let stopped = false;
  let opened = false;
  /** Whether the patch is advancing. Held, there is nothing live and the knobs show what they are set to. */
  let running = useEngineStore.getState().running;
  /** What the engine has been asked to watch, and the slot it answered with, per module. */
  let slots = new Map<string, number>();
  let previewSlots = new Map<string, number>();
  let live = new Map<string, LiveParam[]>();
  /** The display modules among the watched: their slots carry a picture of their own, not knob values. */
  let displays: string[] = [];
  /** The last picture drawn per module, by the engine's own count, so an unchanged one is not redrawn. */
  const drawn = new Map<string, bigint>();
  /** The same for what a display module publishes, kept apart so the two counts cannot cross. */
  const shown = new Map<string, bigint>();
  let lastRequest = "";

  const openSegment = (): void => {
    const shm = useEngineStore.getState().shm;
    window.telemetry.close();
    opened = shm !== null && window.telemetry.open(shm.name, shm.size) !== null;
  };

  /**
   * Refreshes which knobs to drive, and asks the engine for the modules that need watching when
   * that set has changed.
   *
   * Two different things. Which knobs are live is per parameter, pure over the document, and free,
   * so it is taken fresh on every structural edit: a second cable into a module already watched
   * changes nothing the engine needs to hear (it publishes every parameter of a watched module
   * anyway) but adds a knob to turn. The engine's subscription is per module and costs a round trip,
   * so that is only redone when the module list moves. Behind the document queue, so the engine has
   * been told about every module and cable before being asked about them.
   */
  const resubscribe = (force = false): void => {
    if (stopped) return;
    const wanted = modulatedModules(
      usePatchStore.getState().doc,
      useCatalogStore.getState().byId,
    );
    // A knob whose cable went rests at once. Nothing else will put it back: its module may still be
    // watched, and the engine keeps publishing a value for a parameter nothing feeds.
    for (const [moduleId, params] of live)
      for (const { param } of params)
        if (!wanted.get(moduleId)?.some((l) => l.param.id === param.id))
          target.setLive(moduleId, param.id, null);
    live = wanted;
    displays = displayModules(
      usePatchStore.getState().doc,
      useCatalogStore.getState().byId,
    );
    const modules = [...new Set([...wanted.keys(), ...displays])].sort();
    const previews = previewedModules(
      usePatchStore.getState().doc,
      useCatalogStore.getState().byId,
    );
    const request = `${modules.join("\n")}|${previews.join("\n")}`;
    if (!force && request === lastRequest) return;
    lastRequest = request;
    // The old slot maps are wrong from here: the engine numbers slots by the new lists' order, so a
    // module that kept its subscription may move. One empty frame beats a knob reading another's.
    slots = new Map();
    previewSlots = new Map();
    drawn.clear();
    shown.clear();
    afterSync(async () => {
      if (stopped) return;
      try {
        const answer = await useEngineStore
          .getState()
          .call("telemetry.subscribe", { modules, previews });
        slots = new Map(Object.entries(answer.slots));
        // An engine from before pictures answers without this field. Its knobs still work.
        previewSlots = new Map(Object.entries(answer.previewSlots ?? {}));
      } catch {
        // An engine with no segment, or a module gone between the ask and the answer. Nothing to
        // read either way; the knobs stay where the document has them.
        slots = new Map();
        previewSlots = new Map();
      }
    });
  };

  /** Back to the document's values: a held patch has no live value, only the one it is set to. */
  const clearLive = (): void => {
    for (const [moduleId, params] of live)
      for (const { param } of params) target.setLive(moduleId, param.id, null);
  };

  const tick = (): void => {
    if (stopped || !opened) return;
    // A held patch publishes no new values, and the last ones are where the modulation happened to
    // stop rather than anything the knob means now. The pictures still arrive: the engine redraws
    // those from what the patch is set to, so a face follows a knob turned in the silence.
    for (const [moduleId, slot] of running ? slots : []) {
      const reading = window.telemetry.read(slot);
      if (reading === null || reading.kind !== TelemetryKind.Params) continue;
      for (const { param, index } of live.get(moduleId) ?? []) {
        const value = reading.values[index];
        if (value === undefined) continue;
        target.setLive(moduleId, param.id, paramFraction(param, value));
      }
    }
    for (const [moduleId, slot] of previewSlots) {
      const reading = window.telemetry.read(slot);
      if (reading === null || reading.kind !== TelemetryKind.Preview) continue;
      // The engine only publishes when the picture changed, and numbers each publish; a picture
      // already on the panel is not geometry worth rebuilding.
      if (drawn.get(moduleId) === reading.blockIndex) continue;
      drawn.set(moduleId, reading.blockIndex);
      target.setWave(moduleId, reading.samples);
    }
    // Held or running alike: a held patch publishes nothing new, so the last picture simply stays.
    for (const moduleId of displays) {
      const slot = slots.get(moduleId);
      if (slot === undefined) continue;
      const reading = window.telemetry.read(slot);
      if (reading === null) continue;
      if (
        reading.kind !== TelemetryKind.Scope &&
        reading.kind !== TelemetryKind.Value &&
        reading.kind !== TelemetryKind.Meter
      )
        continue;
      if (shown.get(moduleId) === reading.blockIndex) continue;
      shown.set(moduleId, reading.blockIndex);
      if (reading.kind === TelemetryKind.Scope)
        target.setTrace(moduleId, reading.blockIndex, reading.channels);
      else if (reading.kind === TelemetryKind.Value)
        target.setValue(moduleId, reading.blockIndex, reading.values);
      else
        target.setLevel(moduleId, reading.blockIndex, {
          peak: reading.peak,
          rms: reading.rms,
          clipped: reading.clipped,
        });
    }
  };

  const stopOps = usePatchStore.getState().subscribeOps((ops, source) => {
    if (source === "load") {
      resubscribe();
      return;
    }
    if (ops.some((op) => op.op !== "paramSet" && op.op !== "moduleMove"))
      resubscribe();
  });
  // A restarted engine has forgotten every subscription and writes a fresh segment.
  const stopEvents = window.engine.onEvent((event) => {
    if (event.event === "engine.ready") resubscribe(true);
  });
  const stopStore = useEngineStore.subscribe((state, previous) => {
    if (state.shm !== previous.shm || state.status !== previous.status) {
      if (state.status === "ready") openSegment();
    }
    if (state.running !== previous.running) {
      running = state.running;
      if (!running) clearLive();
    }
  });
  const stopCatalog = useCatalogStore.subscribe(() => resubscribe());
  const stopTicks = schedule(tick);

  if (useEngineStore.getState().status === "ready") openSegment();
  resubscribe();

  return {
    stop: () => {
      stopped = true;
      stopOps();
      stopEvents();
      stopStore();
      stopCatalog();
      stopTicks();
      window.telemetry.close();
    },
  };
}

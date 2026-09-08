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
 * This is the one owner of the engine's subscription set. `telemetry.subscribe` replaces the whole
 * set on every call, so a second subscriber elsewhere would silently cancel this one; when meters
 * and scopes arrive they add their modules here.
 */

export interface TelemetryTarget {
  setLive(moduleId: string, paramId: string, fraction: number | null): void;
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
 * `schedule` runs `tick` once per frame and returns how to stop; the canvas passes its ticker, a
 * test calls the tick itself.
 */
export function startTelemetrySync(
  target: TelemetryTarget,
  schedule: (tick: () => void) => () => void,
): TelemetrySync {
  let stopped = false;
  let opened = false;
  /** What the engine has been asked to watch, and the slot it answered with, per module. */
  let slots = new Map<string, number>();
  let live = new Map<string, LiveParam[]>();
  let lastRequest = "";

  const openSegment = (): void => {
    const shm = useEngineStore.getState().shm;
    window.telemetry.close();
    opened = shm !== null && window.telemetry.open(shm.name, shm.size) !== null;
  };

  /**
   * Asks for the modules that need watching, when the set has changed. Behind the document queue,
   * so the engine has been told about every module and cable before being asked about them.
   */
  const resubscribe = (force = false): void => {
    if (stopped) return;
    const wanted = modulatedModules(
      usePatchStore.getState().doc,
      useCatalogStore.getState().byId,
    );
    const modules = [...wanted.keys()].sort();
    const request = modules.join("\n");
    if (!force && request === lastRequest) return;
    lastRequest = request;
    live = wanted;
    // The old slot map is wrong from here: the engine numbers slots by the new list's order, so a
    // module that kept its subscription may move. One empty frame beats a knob reading another's.
    slots = new Map();
    afterSync(async () => {
      if (stopped) return;
      try {
        const { slots: answer } = await useEngineStore
          .getState()
          .call("telemetry.subscribe", { modules });
        slots = new Map(Object.entries(answer));
      } catch {
        // An engine with no segment, or a module gone between the ask and the answer. Nothing to
        // read either way; the knobs stay where the document has them.
        slots = new Map();
      }
    });
  };

  const tick = (): void => {
    if (stopped || !opened) return;
    for (const [moduleId, slot] of slots) {
      const reading = window.telemetry.read(slot);
      if (reading === null || reading.kind !== TelemetryKind.Params) continue;
      for (const { param, index } of live.get(moduleId) ?? []) {
        const value = reading.values[index];
        if (value === undefined) continue;
        target.setLive(moduleId, param.id, paramFraction(param, value));
      }
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

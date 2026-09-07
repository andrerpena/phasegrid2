import { useEngineStore } from "@renderer/engine/engine-store";
import { engineOps, type PatchOp } from "@shared/protocol/patch";
import { usePatchStore } from "./patch-store";

/**
 * Keeps the engine's copy of the patch in step with ours.
 *
 * Ours is the original. The engine is told what changed, in the same vocabulary the change was
 * described in, so there is no translation step to get wrong.
 *
 * Two routes, because the engine has two. A structural change (a module, a cable) goes in a
 * `patch.batch`, which recompiles the graph. A parameter value goes through `param.set`, which hands
 * the audio thread a smoothed target through a lock-free queue and compiles nothing. Sending a knob
 * through the batch route is not merely slow: a compile reuses the running instance, so the document
 * changes and the sound does not. The engine now reconciles that case too, but the queue is the route
 * a knob is meant to take, and it is the only one fast enough to follow a drag.
 *
 * Two things this deliberately does not do. It does not send layout changes: dragging a node moves
 * nothing the engine computes, and sending it would recompile the graph on every mouse move. And it
 * does not send an edit that came from the engine, or the two would answer each other forever.
 */
export function startEngineSync(): () => void {
  const stopOps = usePatchStore.getState().subscribeOps((ops, source) => {
    if (source === "remote") return;
    if (source === "load") {
      enqueue(sendWholePatch);
      return;
    }
    const params = ops.filter(isParamSet);
    const structural = engineOps(ops).filter((op) => !isParamSet(op));
    if (structural.length === 0 && params.length === 0) return;
    enqueue(async () => {
      if (structural.length > 0) await sendBatch(structural);
      for (const op of params) await sendParam(op.module, op.param, op.value);
    });
  });

  // A restarted engine is an empty engine. It has our patch's revision number and none of its content,
  // so the only correct response is to send the whole thing again rather than the next delta.
  const stopEvents = window.engine.onEvent((event) => {
    if (event.event === "engine.ready") enqueue(sendWholePatch);
  });

  return () => {
    stopOps();
    stopEvents();
  };
}

/**
 * A value mid-gesture: the knob is still being dragged.
 *
 * Not a document edit, so it does not go through the store, and not queued behind structural edits,
 * because a drag produces one of these per frame and the release that follows carries the value that
 * counts. A failure is not worth resyncing over for the same reason.
 */
export function sendTransientParam(
  module: string,
  param: string,
  value: number,
): void {
  void useEngineStore
    .getState()
    .call("param.set", { module, param, value, transient: true })
    .catch(() => {});
}

function isParamSet(op: PatchOp): op is Extract<PatchOp, { op: "paramSet" }> {
  return op.op === "paramSet";
}

/**
 * Document edits are sent one after another, in the order they were made.
 *
 * Each edit can be several calls, and two edits made in quick succession would otherwise interleave:
 * the second's batch could remove the module the first's parameter is still on its way to. The queue
 * is what turns "sent in order" from a hope into a guarantee.
 */
let queue: Promise<void> = Promise.resolve();
function enqueue(task: () => Promise<void>): void {
  queue = queue.then(task, task);
}

/**
 * Runs `task` once every document edit made so far has been sent.
 *
 * For anything that asks the engine about the document: a question sent before the edit it concerns
 * would be answered about the wrong document, or about a module the engine has not been told exists.
 */
export function afterSync(task: () => Promise<void>): void {
  enqueue(task);
}

async function sendBatch(ops: PatchOp[]): Promise<void> {
  try {
    await useEngineStore.getState().call("patch.batch", { ops });
  } catch {
    // The engine rejected the batch, so its patch and ours have diverged. Rather than guess which
    // operation it disliked, resend the whole document: it is the only state we are sure of.
    await sendWholePatch();
  }
}

async function sendParam(
  module: string,
  param: string,
  value: number,
): Promise<void> {
  try {
    await useEngineStore.getState().call("param.set", { module, param, value });
  } catch {
    await sendWholePatch();
  }
}

async function sendWholePatch(): Promise<void> {
  const doc = usePatchStore.getState().doc;
  try {
    await useEngineStore.getState().call("patch.load", { patch: doc });
  } catch {
    // Reported through the engine store's status; nothing here can do better than say so.
  }
}

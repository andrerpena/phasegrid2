import { useEngineStore } from "@renderer/engine/engine-store";
import { engineOps, type PatchOp } from "@shared/protocol/patch";
import { usePatchStore } from "./patch-store";

/**
 * Keeps the engine's copy of the patch in step with ours.
 *
 * Ours is the original. The engine is told what changed, in the same vocabulary the change was
 * described in, so there is no translation step to get wrong.
 *
 * Two things it deliberately does not do. It does not send layout changes: dragging a node moves
 * nothing the engine computes, and sending it would recompile the graph on every mouse move. And it
 * does not send an edit that came from the engine, or the two would answer each other forever.
 */
export function startEngineSync(): () => void {
  const stopOps = usePatchStore.getState().subscribeOps((ops, source) => {
    if (source === "remote") return;
    if (source === "load") {
      void sendWholePatch();
      return;
    }
    const toSend = engineOps(ops);
    if (toSend.length === 0) return;
    void sendBatch(toSend);
  });

  // A restarted engine is an empty engine. It has our patch's revision number and none of its content,
  // so the only correct response is to send the whole thing again rather than the next delta.
  const stopEvents = window.engine.onEvent((event) => {
    if (event.event === "engine.ready") void sendWholePatch();
  });

  return () => {
    stopOps();
    stopEvents();
  };
}

async function sendBatch(ops: PatchOp[]): Promise<void> {
  try {
    await useEngineStore.getState().call("patch.batch", { ops });
  } catch {
    // The engine rejected the batch, so its patch and ours have diverged. Rather than guess which
    // operation it disliked, resend the whole document: it is the only state we are sure of.
    void sendWholePatch();
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

import { usePatchStore } from "@renderer/patch/patch-store";
import { useProjectStore } from "./project-store";

/**
 * Marks the project in front as having unsaved work.
 *
 * A subscription to the same stream of operations the engine follows, rather than a flag set by every
 * place that edits: an edit that reaches the document but not this listener is impossible, where an edit
 * that reaches the document but forgets to set a flag is a Tuesday. Only `user` edits count — loading a
 * project is not a change to it, and an operation the engine told us about is not one we made.
 *
 * Transient operations count too. A knob still under a hand has already changed the piece; waiting for
 * the gesture to end would leave a window in which the tab looks saved and is not.
 */
export function startDirtyTracking(): () => void {
  return usePatchStore.getState().subscribeOps((ops, source) => {
    if (source !== "user" || ops.length === 0) return;
    const id = useProjectStore.getState().activeId;
    if (id !== null) useProjectStore.getState().markDirty(id);
  });
}

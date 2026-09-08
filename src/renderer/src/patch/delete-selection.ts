import { usePatchStore } from "@renderer/patch/patch-store";
import { useProjectStore } from "@renderer/project/project-store";
import { useSelectionStore } from "@renderer/selection/selection-store";
import type { PatchOp } from "@shared/protocol/patch";

/**
 * Removes what is selected.
 *
 * Only `moduleRemove` operations are recorded, because removing a module already takes its cables with
 * it — in `applyOps`, in `invert`, and in the engine's own `GraphModel::removeNode`. Adding explicit
 * `edgeRemove` operations beside them would be a second description of the same thing, and the first
 * time the two disagreed the patch and the engine would disagree.
 *
 * One edit for the whole selection, so undo puts back everything that went, cables included.
 */
export function deleteSelection(): void {
  const project = useProjectStore.getState().active();
  // An example's wiring is fixed: that is what makes it a demonstration rather than a document, and
  // deleting from one would be the single most confusing way to find out it was never yours to edit.
  if (project === null || project.kind === "example") return;

  const selected = useSelectionStore.getState().modules;
  if (selected.length === 0) return;

  const doc = usePatchStore.getState().doc;
  const present = doc.modules.filter((m) => selected.includes(m.id));
  if (present.length === 0) {
    // Selected ids that are no longer in the document. Nothing to do, and clearing is the honest
    // response: the selection was describing something that has gone.
    useSelectionStore.getState().clear();
    return;
  }

  const ops = present.map((m): PatchOp => ({ op: "moduleRemove", id: m.id }));
  usePatchStore.getState().apply(ops, {
    label:
      present.length === 1
        ? `Delete ${present[0]?.label ?? present[0]?.type ?? "module"}`
        : `Delete ${present.length} modules`,
  });
  useSelectionStore.getState().clear();
}

import { useProjectStore } from "@renderer/project/project-store";
import { useWorkspaceStore } from "./workspace-store";

/**
 * Asking about unsaved work, in the one place that does it.
 *
 * Closing a tab, switching workspace and closing the window are the same question asked about different
 * sets of projects, so they are the same function. The box itself is native and belongs to the main
 * process: a window that will not close until an HTML dialog has been answered is a window that can fail
 * to close at all.
 */

/** True when it is safe to go on. False means the person said Cancel and nothing should happen. */
export async function resolveUnsaved(
  ids?: readonly string[],
): Promise<boolean> {
  const state = useProjectStore.getState();
  const dirty = state.projects.filter(
    (p) => state.isDirty(p.id) && (ids === undefined || ids.includes(p.id)),
  );
  if (dirty.length === 0) return true;

  const answer = await window.workspace.confirmUnsaved(
    dirty.map((p) => p.name),
  );
  if (!answer.ok || answer.value === "cancel") return false;
  if (answer.value === "discard") return true;

  // Saving here never asks for a name: an unnamed project is filed under the name it already has. A
  // dialog that appears while you are quitting, asking where to put something, is a dialog nobody reads.
  for (const project of dirty) {
    const saved = await useWorkspaceStore.getState().saveProject(project.id);
    if (!saved) return false;
  }
  return true;
}

/** Closes a tab, asking first if it has work in it. */
export async function closeProject(id: string): Promise<void> {
  if (!(await resolveUnsaved([id]))) return;
  useProjectStore.getState().close(id);
}

/**
 * Answers the main process when the window wants to close.
 *
 * Main refuses the close and asks; this decides; `allowClose` closes for real. Saying nothing is a
 * perfectly good answer, and means the window stays.
 */
export function startCloseGuard(): () => void {
  return window.workspace.onConfirmClose(() => {
    void (async () => {
      if (await resolveUnsaved()) await window.workspace.allowClose();
    })();
  });
}

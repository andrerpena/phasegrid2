import { type BrowserWindow, dialog } from "electron";
import type { UnsavedChoice } from "../../../shared/protocol/workspace";

/**
 * The three questions this feature has to ask, asked natively.
 *
 * Native rather than in-app for all three, because each one is about the window itself — where its
 * documents live, and whether it may close — and a window that will not close until an HTML dialog has
 * been answered is a window that can fail to close at all.
 *
 * Naming a project is the exception and stays in-app: its answer goes inside the workspace, and a native
 * save panel that let you point anywhere would make the workspace a lie.
 */

export async function chooseWorkspaceFolder(
  window: BrowserWindow,
): Promise<string | null> {
  const answer = await dialog.showOpenDialog(window, {
    title: "Open Workspace",
    message: "Pick a folder to keep your projects, settings and modules in.",
    buttonLabel: "Open Workspace",
    properties: ["openDirectory", "createDirectory"],
  });
  if (answer.canceled) return null;
  return answer.filePaths[0] ?? null;
}

export async function confirmUnsaved(
  window: BrowserWindow,
  names: readonly string[],
): Promise<UnsavedChoice> {
  const what =
    names.length === 1
      ? `“${names[0]}” has unsaved changes.`
      : `${names.length} projects have unsaved changes.`;
  const answer = await dialog.showMessageBox(window, {
    type: "warning",
    message: what,
    detail:
      names.length === 1
        ? "If you don't save them, they will be lost."
        : `If you don't save them, they will be lost:\n${names.join("\n")}`,
    buttons: ["Save", "Don't Save", "Cancel"],
    defaultId: 0,
    // Escape and the window's own close button both land on Cancel, so the accidental answer is the
    // one that loses nothing.
    cancelId: 2,
    noLink: true,
  });
  return (["save", "discard", "cancel"] as const)[answer.response] ?? "cancel";
}

export async function confirmDelete(
  window: BrowserWindow,
  name: string,
): Promise<boolean> {
  const answer = await dialog.showMessageBox(window, {
    type: "warning",
    message: `Delete “${name}”?`,
    detail:
      "The project folder and everything in it is removed from the workspace.",
    buttons: ["Delete", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  return answer.response === 0;
}

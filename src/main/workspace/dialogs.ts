import { type BrowserWindow, dialog } from "electron";
import type {
  DialogAnswer,
  DialogKind,
  UnsavedChoice,
} from "../../../shared/protocol/workspace";

/**
 * The three questions this feature has to ask, asked natively.
 *
 * Native rather than in-app for all three, because each one is about the window itself — where its
 * documents live, and whether it may close — and a window that will not close until an HTML dialog has
 * been answered is a window that can fail to close at all.
 *
 * Naming a project is the exception and stays in-app: its answer goes inside the workspace, and a native
 * save panel that let you point anywhere would make the workspace a lie.
 *
 * Behind an interface, because a native box cannot be answered by a script and the flows that lead
 * to one -- closing a dirty tab, deleting a project, picking a folder -- are exactly the flows worth
 * driving end to end. `scriptedDialogs` wraps the native host with a queue of answers given ahead
 * of time; a queued answer is consumed by the next question of its kind, and with nothing queued the
 * box appears as it always did.
 */
export interface DialogHost {
  chooseWorkspaceFolder(window: BrowserWindow): Promise<string | null>;
  confirmUnsaved(
    window: BrowserWindow,
    names: readonly string[],
  ): Promise<UnsavedChoice>;
  confirmDelete(window: BrowserWindow, name: string): Promise<boolean>;
}

export const nativeDialogs: DialogHost = {
  async chooseWorkspaceFolder(window) {
    const answer = await dialog.showOpenDialog(window, {
      title: "Open Workspace",
      message: "Pick a folder to keep your projects, settings and modules in.",
      buttonLabel: "Open Workspace",
      properties: ["openDirectory", "createDirectory"],
    });
    if (answer.canceled) return null;
    return answer.filePaths[0] ?? null;
  },

  async confirmUnsaved(window, names) {
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
    return (
      (["save", "discard", "cancel"] as const)[answer.response] ?? "cancel"
    );
  },

  async confirmDelete(window, name) {
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
  },
};

export interface ScriptedDialogs extends DialogHost {
  /** Queues the answer the next question of `kind` gets. Answers of one kind are given in order. */
  answer(kind: DialogKind, answer: DialogAnswer): void;
  /** How many answers are waiting, per kind. */
  pending(): Record<DialogKind, number>;
}

/** A host that answers from a queue first and asks `fallback` when the queue is empty. */
export function scriptedDialogs(fallback: DialogHost): ScriptedDialogs {
  const queues: Record<DialogKind, DialogAnswer[]> = {
    chooseWorkspace: [],
    confirmUnsaved: [],
    confirmDelete: [],
  };
  const take = (kind: DialogKind): DialogAnswer | undefined =>
    queues[kind].shift();
  return {
    answer(kind, answer) {
      queues[kind].push(answer);
    },
    pending: () => ({
      chooseWorkspace: queues.chooseWorkspace.length,
      confirmUnsaved: queues.confirmUnsaved.length,
      confirmDelete: queues.confirmDelete.length,
    }),
    async chooseWorkspaceFolder(window) {
      const queued = take("chooseWorkspace");
      if (queued !== undefined)
        return typeof queued === "string" ? queued : null;
      return fallback.chooseWorkspaceFolder(window);
    },
    async confirmUnsaved(window, names) {
      const queued = take("confirmUnsaved");
      if (queued === "save" || queued === "discard" || queued === "cancel")
        return queued;
      return fallback.confirmUnsaved(window, names);
    },
    async confirmDelete(window, name) {
      const queued = take("confirmDelete");
      if (typeof queued === "boolean") return queued;
      return fallback.confirmDelete(window, name);
    },
  };
}

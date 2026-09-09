import { existsSync } from "node:fs";
import type { BrowserWindow, IpcMain } from "electron";
import type { StorageResult } from "../../../shared/protocol/storage";
import {
  isDialogKind,
  isWorkspaceOp,
  WORKSPACE_CALL_CHANNEL,
  type WorkspaceInfo,
  type WorkspaceOp,
} from "../../../shared/protocol/workspace";
import { type DialogHost, nativeDialogs, scriptedDialogs } from "./dialogs";
import { readPointer, rememberWorkspace } from "./pointer";
import * as fs from "./workspace-fs";

/**
 * The workspace, answered over one channel.
 *
 * One channel carrying a validated op name, following `engine:call`, rather than a dozen channels shaped
 * like `storage:read` for a single feature. The op is checked here because IPC is a boundary; so is
 * every path, which is why nothing in this file joins one itself and everything goes through
 * `workspace-fs`, which goes through `path-guard`.
 *
 * The open workspace is held here rather than being passed in with every call. The renderer therefore
 * cannot name a root at all — only a slug within whatever root the user chose — and there is one place
 * that knows which folder is open rather than one per message.
 */

export interface WorkspaceHost {
  window: BrowserWindow;
  userData: string;
  /**
   * A folder named on the command line (`--workspace`), opened for this launch instead of the
   * remembered one and never remembered itself. It is how a scripted run gets a folder of its own
   * without touching the pointer to the workspace the person was in.
   */
  launchWorkspace?: string | null;
  /** Who asks the native questions. The real boxes unless a test supplies something else. */
  dialogs?: DialogHost;
}

let root: string | null = null;
/** Set once the renderer has finished asking about unsaved work; see `guardClose`. */
let closing = false;
/**
 * Cleared by the renderer's first reply to a close request.
 *
 * A window that refuses to close until the renderer answers is a window that cannot be closed at all if
 * the renderer never does — a bundle that failed to load leaves an application you have to kill from a
 * terminal. So the ask is given a few seconds to be acknowledged, and any reply at all cancels it; from
 * then on the renderer may take as long as the person in front of it needs.
 */
let closeTimer: NodeJS.Timeout | null = null;

function acknowledgeClose(): void {
  if (closeTimer === null) return;
  clearTimeout(closeTimer);
  closeTimer = null;
}

const ok = <T>(value: T): StorageResult<T> => ({ ok: true, value });
const noWorkspace = { ok: false, error: "no workspace is open" } as const;

/** For tests and for a restart: forget everything this module is holding. */
export function resetWorkspaceState(): void {
  root = null;
  closing = false;
  acknowledgeClose();
}

async function open(
  host: WorkspaceHost,
  candidate: string,
): Promise<StorageResult<WorkspaceInfo>> {
  const opened = await fs.openWorkspace(candidate);
  if (!opened.ok) return opened;
  root = opened.value.root;
  await rememberWorkspace(host.userData, opened.value.root);
  return opened;
}

/** Every question goes through the scripted host, so an answer can be queued for any of them. */
let dialogs = scriptedDialogs(nativeDialogs);

async function run(
  host: WorkspaceHost,
  op: WorkspaceOp,
  args: unknown[],
): Promise<StorageResult<unknown>> {
  const text = (i: number): string =>
    typeof args[i] === "string" ? (args[i] as string) : "";

  switch (op) {
    case "current": {
      if (host.launchWorkspace) {
        const opened = await fs.openWorkspace(host.launchWorkspace);
        if (!opened.ok) return opened;
        root = opened.value.root;
        return ok(opened.value);
      }
      const pointer = await readPointer(host.userData);
      // Verified against the disk rather than trusted: a workspace can be moved or deleted between one
      // launch and the next, and reopening the shell onto a folder that is not there would be worse
      // than showing the gate.
      if (pointer.path === null || !existsSync(pointer.path)) return ok(null);
      const opened = await fs.openWorkspace(pointer.path);
      if (!opened.ok) return ok(null);
      root = opened.value.root;
      return ok(opened.value);
    }
    case "recent": {
      const pointer = await readPointer(host.userData);
      return ok(pointer.recent.filter((path) => existsSync(path)));
    }
    case "choose": {
      const picked = await dialogs.chooseWorkspaceFolder(host.window);
      if (picked === null) return ok(null);
      return await open(host, picked);
    }
    case "openAt":
      return await open(host, text(0));

    case "readSettings":
      return root === null ? noWorkspace : await fs.readSettings(root);
    case "writeSettings":
      return root === null
        ? noWorkspace
        : await fs.writeSettings(root, text(0));

    case "listProjects":
      return root === null ? noWorkspace : await fs.listProjects(root);
    case "readProject":
      return root === null ? noWorkspace : await fs.readProject(root, text(0));
    case "writeProject":
      return root === null
        ? noWorkspace
        : await fs.writeProject(root, text(0), text(1));
    case "deleteProject":
      return root === null
        ? noWorkspace
        : await fs.deleteProject(root, text(0));

    case "readSession":
      return root === null ? noWorkspace : await fs.readSession(root);
    case "writeSession":
      return root === null ? noWorkspace : await fs.writeSession(root, text(0));

    case "confirmUnsaved": {
      const names = Array.isArray(args[0])
        ? (args[0] as unknown[]).filter(
            (n): n is string => typeof n === "string",
          )
        : [];
      if (names.length === 0) return ok("discard");
      return ok(await dialogs.confirmUnsaved(host.window, names));
    }
    case "confirmDelete":
      return ok(await dialogs.confirmDelete(host.window, text(0)));

    case "allowClose": {
      closing = true;
      host.window.close();
      return ok(undefined);
    }

    case "answerDialog": {
      const kind = text(0);
      if (!isDialogKind(kind))
        return { ok: false, error: `unknown dialog kind ${kind}` };
      const answer = args[1];
      if (
        typeof answer !== "string" &&
        typeof answer !== "boolean" &&
        answer !== null
      )
        return {
          ok: false,
          error: "a dialog answer is a string, a boolean or null",
        };
      dialogs.answer(kind, answer);
      return ok(undefined);
    }
  }
}

export function registerWorkspaceIpc(
  ipcMain: IpcMain,
  host: WorkspaceHost,
): void {
  dialogs = scriptedDialogs(host.dialogs ?? nativeDialogs);
  ipcMain.handle(
    WORKSPACE_CALL_CHANNEL,
    async (_event, op: unknown, ...args: unknown[]) => {
      if (typeof op !== "string" || !isWorkspaceOp(op))
        return {
          ok: false,
          error: `unknown workspace operation ${String(op)}`,
        };
      acknowledgeClose();
      try {
        return await run(host, op, args);
      } catch (error) {
        // Nothing here is worth taking the main process down for, and the renderer has somewhere to
        // show it.
        return { ok: false, error: (error as Error).message };
      }
    },
  );
}

/**
 * Refuses the first close and asks the renderer about unsaved work.
 *
 * The renderer runs its own save flow and answers by calling `allowClose`, which sets the flag and
 * closes for real. One mechanism serves the close button and quitting, since `window-all-closed` already
 * quits. There is deliberately no mirror of the dirty state here: a mirror is a second source of truth,
 * and the round trip is one message.
 */
export function guardClose(
  window: BrowserWindow,
  onAsk: (window: BrowserWindow) => void,
  graceMs = 5000,
): void {
  window.on("close", (event) => {
    if (closing) return;
    if (window.webContents.isDestroyed() || window.webContents.isCrashed())
      return;
    event.preventDefault();
    onAsk(window);
    if (closeTimer !== null) return;
    closeTimer = setTimeout(() => {
      closeTimer = null;
      closing = true;
      if (!window.isDestroyed()) window.close();
    }, graceMs);
  });
}

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { IpcMain } from "electron";
import {
  isStorageKey,
  STORAGE_READ_CHANNEL,
  STORAGE_WRITE_CHANNEL,
  type StorageKey,
  type StorageResult,
} from "../../../shared/protocol/storage";
import { writeFileAtomic } from "./atomic-write";

/**
 * Installation-level state on disk: one JSON file per key under the user data directory.
 *
 * Two keys live here and nothing else does. `layout` is the dock, which is shaped by the screen in front
 * of you rather than by any folder; `workspace` is the pointer to the workspace you were last in,
 * because something has to survive outside a workspace in order to find it. Separate files rather than
 * one, so a corrupt layout cannot cost you the way back to your work.
 */

function pathFor(userData: string, key: StorageKey): string {
  return join(userData, "settings", `${key}.json`);
}

export async function readSetting(
  userData: string,
  key: StorageKey,
): Promise<StorageResult<string | null>> {
  try {
    return { ok: true, value: await readFile(pathFor(userData, key), "utf8") };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // Absent is not an error. The first run has no settings, and treating that as a failure would put a
    // warning in front of every new user.
    if (code === "ENOENT") return { ok: true, value: null };
    return { ok: false, error: (error as Error).message };
  }
}

export async function writeSetting(
  userData: string,
  key: StorageKey,
  text: string,
): Promise<StorageResult<void>> {
  try {
    await writeFileAtomic(pathFor(userData, key), text);
    return { ok: true, value: undefined };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}

/** Wires both operations onto IPC. The key is checked here because IPC is a boundary. */
export function registerAppStorageIpc(
  ipcMain: IpcMain,
  userData: string,
): void {
  ipcMain.handle(STORAGE_READ_CHANNEL, async (_event, key: unknown) => {
    if (typeof key !== "string" || !isStorageKey(key))
      return { ok: false, error: `unknown storage key ${String(key)}` };
    return readSetting(userData, key);
  });
  ipcMain.handle(
    STORAGE_WRITE_CHANNEL,
    async (_event, key: unknown, text: unknown) => {
      if (typeof key !== "string" || !isStorageKey(key))
        return { ok: false, error: `unknown storage key ${String(key)}` };
      if (typeof text !== "string")
        return { ok: false, error: "value must be a string" };
      return writeSetting(userData, key, text);
    },
  );
}

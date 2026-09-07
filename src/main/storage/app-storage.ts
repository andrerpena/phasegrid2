import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { IpcMain } from "electron";
import {
  isStorageKey,
  STORAGE_READ_CHANNEL,
  STORAGE_WRITE_CHANNEL,
  type StorageKey,
  type StorageResult,
} from "../../../shared/protocol/storage";

/**
 * Application settings on disk: one JSON file per key under the user data directory.
 *
 * Separate files rather than one, so a corrupt layout cannot cost the user their keybindings. Each is
 * written by rename, which is the only way to be sure a reader never sees a half-written file: writing
 * in place leaves a window where the file exists but is truncated, and that window is exactly when a
 * crash or a power cut will find it.
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
  const target = pathFor(userData, key);
  const temporary = `${target}.tmp`;
  try {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(temporary, text, "utf8");
    // Rename is atomic within a filesystem: the file is either the old contents or the new one, never
    // half of each.
    await rename(temporary, target);
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

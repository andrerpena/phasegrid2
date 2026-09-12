import { z } from "zod";

/**
 * Application-level storage: the two things that belong to the installation rather than to a workspace.
 *
 * The dock layout, because it is shaped by the screen in front of you; and the pointer to the workspace
 * you were last in, because something has to survive outside the workspace in order to find it. Settings
 * and keybindings used to live here and now do not: they belong to the workspace folder, which is a
 * thing you copy to another machine and which has to arrive complete without dragging that machine's
 * panel sizes along with it.
 */

/** What a stored value may be. Anything JSON can hold, since that is what it is written as. */
export type ConfigValue =
  | string
  | number
  | boolean
  | null
  | ConfigValue[]
  | { [key: string]: ConfigValue };

/** Dot-path keys, e.g. `{"engine.blockSize": 64, "ui.theme": "dark"}`. */
export type ConfigRecord = Record<string, ConfigValue>;

/**
 * The same thing as a schema, for the places that read configuration off a disk rather than out of a
 * store. Recursive, because a setting may be a list of keybindings as easily as it may be a number.
 */
export const ConfigValueSchema: z.ZodType<ConfigValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(ConfigValueSchema),
    z.record(ConfigValueSchema),
  ]),
);

/**
 * What storage answers.
 *
 * A result rather than a thrown error, because every caller here is doing something optional: failing to
 * read a preferences file should open the application with defaults, not stop it opening.
 */
export type StorageResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/** The keys the application stores. Named so a typo is a type error rather than a silent empty read. */
export const STORAGE_KEYS = ["layout", "workspace"] as const;
export type StorageKey = (typeof STORAGE_KEYS)[number];

export function isStorageKey(key: string): key is StorageKey {
  return (STORAGE_KEYS as readonly string[]).includes(key);
}

/** What the renderer sees as `window.appStorage`. */
export interface AppStorageBridge {
  read(key: StorageKey): Promise<StorageResult<string | null>>;
  write(key: StorageKey, text: string): Promise<StorageResult<void>>;
}

export const STORAGE_READ_CHANNEL = "storage:read";
export const STORAGE_WRITE_CHANNEL = "storage:write";

import { z } from "zod";
import { ConfigValueSchema, type StorageResult } from "./storage";

/**
 * The workspace: a folder holding many projects, the settings, and later the modules a user builds.
 *
 * A folder rather than a file because of that last part. A user-authored module belongs beside the
 * projects that use it, not inside one of them, and a format that begins as "a project is a file" has to
 * be broken later to admit that.
 *
 * Everything here describes what crosses IPC or what sits on disk. The filesystem itself is the main
 * process's business alone: the renderer names a project by its slug and never by a path, so there is
 * exactly one place — `path-guard.ts` — that can be wrong about where a file may be written.
 */

/** The workspace file, `workspace.json`, at the root of the folder. */
export const WorkspaceFileSchema = z.object({
  schemaVersion: z.literal(1),
  /** Shown in the status bar. Defaults to the folder's own name when the workspace is scaffolded. */
  name: z.string().min(1),
  /**
   * The settings, which are exactly the overrides `config-store` already holds: dot-path keys over the
   * built-in defaults. Keybindings are one key in here rather than a file of their own, because a
   * keybinding is a setting and a second file is a second place to look.
   */
  settings: z.record(ConfigValueSchema).default({}),
});

/** Which projects were open, and which was in front. Written to `.phasegrid/session.json`. */
export const SessionFileSchema = z.object({
  schemaVersion: z.literal(1),
  /** Slugs, so an example — which has nowhere on disk — cannot appear here. */
  open: z.array(z.string()).default([]),
  active: z.string().nullable().default(null),
});

/**
 * What the pointer under `userData` remembers: where we were, and where we have been.
 *
 * This and the dock layout are the only things that stay with the installation. Everything else belongs
 * to the folder, so a workspace copied to another machine arrives complete and does not drag that
 * machine's panel sizes along with it.
 */
export const WorkspacePointerSchema = z.object({
  path: z.string().nullable().default(null),
  recent: z.array(z.string()).default([]),
});

export type WorkspaceFile = z.infer<typeof WorkspaceFileSchema>;
export type SessionFile = z.infer<typeof SessionFileSchema>;
export type WorkspacePointer = z.infer<typeof WorkspacePointerSchema>;

export interface WorkspaceInfo {
  root: string;
  name: string;
}

/** Enough to list a project without opening it. */
export interface ProjectSummary {
  slug: string;
  name: string;
  /** Modification time of `project.json`, for ordering the list by what you touched last. */
  updatedAt: number;
}

/** What the box asking about unsaved work answers. */
export type UnsavedChoice = "save" | "discard" | "cancel";

/**
 * What a folder under `projects/` may be called.
 *
 * Defined here rather than in the main process because both sides need it: the renderer has to be able
 * to make a slug that the main process will accept, and two copies of this rule would eventually
 * disagree about some name with an apostrophe in it.
 */
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isSlug(value: string): boolean {
  return SLUG.test(value);
}

/**
 * A folder name from a name a person typed.
 *
 * Deliberately lossy and ASCII-only: this is a filesystem identifier, not a title. The title is kept in
 * the project itself, so nothing anybody wrote is thrown away by being unrepresentable here.
 */
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "");
  return isSlug(slug) ? slug : "untitled";
}

/** `my-track`, then `my-track-2`, and so on. Never silently overwrites somebody else's work. */
export function uniqueSlug(slug: string, taken: readonly string[]): string {
  if (!taken.includes(slug)) return slug;
  for (let n = 2; ; n++) {
    const candidate = `${slug.slice(0, 60)}-${n}`;
    if (!taken.includes(candidate)) return candidate;
  }
}

/** The entries in the workspace, as they sit on disk. */
export const WORKSPACE_FILE = "workspace.json";
export const PROJECTS_DIR = "projects";
export const MODULES_DIR = "modules";
export const INTERNAL_DIR = ".phasegrid";
export const PROJECT_FILE = "project.json";
export const SESSION_FILE = "session.json";

/**
 * The operations, named so an unknown one is refused at the boundary.
 *
 * One channel carrying a validated op name, following `engine:call`, rather than a dozen channels shaped
 * like `storage:read` for a single feature.
 */
export const WORKSPACE_OPS = [
  "current",
  "recent",
  "choose",
  "openAt",
  "readSettings",
  "writeSettings",
  "listProjects",
  "readProject",
  "writeProject",
  "deleteProject",
  "readSession",
  "writeSession",
  "confirmUnsaved",
  "confirmDelete",
  "allowClose",
  "answerDialog",
] as const;

export type WorkspaceOp = (typeof WORKSPACE_OPS)[number];

export function isWorkspaceOp(op: string): op is WorkspaceOp {
  return (WORKSPACE_OPS as readonly string[]).includes(op);
}

/**
 * The native questions a script can answer ahead of time: the folder chooser (a path, or null for
 * cancel), the unsaved-work box (`save`, `discard`, `cancel`) and the delete confirmation (a boolean).
 */
export const DIALOG_KINDS = [
  "chooseWorkspace",
  "confirmUnsaved",
  "confirmDelete",
] as const;
export type DialogKind = (typeof DIALOG_KINDS)[number];
export type DialogAnswer = string | boolean | null;

export function isDialogKind(kind: string): kind is DialogKind {
  return (DIALOG_KINDS as readonly string[]).includes(kind);
}

export const WORKSPACE_CALL_CHANNEL = "workspace:call";
/** Main to renderer: the window wants to close and is waiting to be told it may. */
export const CONFIRM_CLOSE_CHANNEL = "app:confirm-close";

/**
 * What the renderer sees as `window.workspace`.
 *
 * Every call answers a `StorageResult` rather than throwing. Nothing here is fatal: a workspace that has
 * been moved, a project whose file will not parse, a dialog someone cancelled — all of them are ordinary
 * events that the interface has to show, and an exception is a bad way to say so.
 */
export interface WorkspaceBridge {
  /** The remembered workspace, if it is still there. Null on a first run, or after the folder moved. */
  current(): Promise<StorageResult<WorkspaceInfo | null>>;
  recent(): Promise<StorageResult<string[]>>;
  /** Folder dialog; scaffolds the folder if it is not a workspace yet. Null when cancelled. */
  choose(): Promise<StorageResult<WorkspaceInfo | null>>;
  openAt(root: string): Promise<StorageResult<WorkspaceInfo>>;

  /** The `settings` object, pretty-printed. Null when the workspace file has none. */
  readSettings(): Promise<StorageResult<string | null>>;
  writeSettings(text: string): Promise<StorageResult<void>>;

  listProjects(): Promise<StorageResult<ProjectSummary[]>>;
  readProject(slug: string): Promise<StorageResult<string>>;
  writeProject(slug: string, text: string): Promise<StorageResult<void>>;
  deleteProject(slug: string): Promise<StorageResult<void>>;

  readSession(): Promise<StorageResult<string | null>>;
  writeSession(text: string): Promise<StorageResult<void>>;

  confirmUnsaved(names: string[]): Promise<StorageResult<UnsavedChoice>>;
  confirmDelete(name: string): Promise<StorageResult<boolean>>;

  /** The renderer has finished asking about unsaved work and the window may now go. */
  allowClose(): Promise<StorageResult<void>>;
  /** Queues the answer the next native dialog of `kind` gives, instead of showing it. */
  answerDialog(
    kind: DialogKind,
    answer: DialogAnswer,
  ): Promise<StorageResult<void>>;
  /** Main is asking. Returns the unsubscribe. */
  onConfirmClose(listener: () => void): () => void;
}

import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { StorageResult } from "../../../shared/protocol/storage";
import {
  INTERNAL_DIR,
  MODULES_DIR,
  PROJECT_FILE,
  PROJECTS_DIR,
  type ProjectSummary,
  SESSION_FILE,
  WORKSPACE_FILE,
  WorkspaceFileSchema,
  type WorkspaceInfo,
} from "../../../shared/protocol/workspace";
import { writeFileAtomic } from "../storage/atomic-write";
import { projectDir, resolveInside } from "./path-guard";

/**
 * The workspace on disk.
 *
 * Every function takes the root explicitly and returns a result rather than throwing, so the same code
 * that serves IPC can be exercised against a temporary folder with no Electron anywhere near it. Nothing
 * here is fatal: a workspace that moved, a project whose file will not parse, a folder somebody made by
 * hand — all of them are ordinary and the interface has to be able to say so.
 */

function fail(error: unknown): { ok: false; error: string } {
  return { ok: false, error: (error as Error).message };
}

const ok = <T>(value: T): { ok: true; value: T } => ({ ok: true, value });

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** The workspace file, or null when this folder is not a workspace or its file is unreadable. */
async function readWorkspaceFile(
  root: string,
): Promise<ReturnType<typeof WorkspaceFileSchema.parse> | null> {
  const text = await readText(join(root, WORKSPACE_FILE));
  if (text === null) return null;
  try {
    const parsed = WorkspaceFileSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * The workspace file as it literally is, unvalidated.
 *
 * Needed when writing settings back: the schema strips what it does not know about, so merging into the
 * parsed object would quietly delete any field a person had added to their own file by hand.
 */
async function readWorkspaceRaw(
  root: string,
): Promise<Record<string, unknown> | null> {
  const text = await readText(join(root, WORKSPACE_FILE));
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function isWorkspace(root: string): Promise<boolean> {
  return (await readWorkspaceFile(root)) !== null;
}

/**
 * Writes the folder a workspace is.
 *
 * The empty `projects/` and `modules/` are created straight away rather than on first use, because the
 * shape of a workspace should be legible by looking at one. `modules/` is empty for now and is here
 * because it is the reason a workspace is a folder at all.
 *
 * Additive: a folder that already holds something keeps it. Someone pointing the dialog at an existing
 * directory of their own is choosing where their work lives, not asking for it to be cleared.
 */
export async function scaffold(
  root: string,
): Promise<StorageResult<WorkspaceInfo>> {
  try {
    // The folder itself must already exist. The dialog can create one, and creating it here would turn
    // a mistyped path into a new empty workspace in a place nobody meant.
    if (!(await stat(root)).isDirectory())
      return { ok: false, error: `not a folder: ${root}` };

    for (const dir of [PROJECTS_DIR, MODULES_DIR, INTERNAL_DIR])
      await mkdir(resolveInside(root, dir), { recursive: true });

    const name = basename(root) || "workspace";
    await writeFileAtomic(
      join(root, WORKSPACE_FILE),
      `${JSON.stringify({ schemaVersion: 1, name, settings: {} }, null, 2)}\n`,
    );
    // The session is this machine's business, not the workspace's, so a workspace kept in version
    // control does not carry one machine's open tabs to another.
    const ignore = join(root, ".gitignore");
    if ((await readText(ignore)) === null)
      await writeFileAtomic(ignore, `${INTERNAL_DIR}/\n`);
    return ok({ root, name });
  } catch (error) {
    return fail(error);
  }
}

/** Opens a folder as a workspace, scaffolding it if it is not one yet. */
export async function openWorkspace(
  root: string,
): Promise<StorageResult<WorkspaceInfo>> {
  try {
    const file = await readWorkspaceFile(root);
    if (file !== null) return ok({ root, name: file.name });
    return await scaffold(root);
  } catch (error) {
    return fail(error);
  }
}

export async function readSettings(
  root: string,
): Promise<StorageResult<string | null>> {
  try {
    const file = await readWorkspaceFile(root);
    // A workspace file that will not parse costs the settings and nothing else. The projects beside it
    // are the part that cannot be recreated, and they are still there.
    if (file === null) return ok(null);
    return ok(`${JSON.stringify(file.settings, null, 2)}\n`);
  } catch (error) {
    return fail(error);
  }
}

/**
 * Replaces the `settings` object, preserving everything beside it.
 *
 * The renderer edits settings as text and this parses it again before writing, so nothing that failed to
 * parse can reach the file. What is lost is the user's own whitespace inside `settings`, regenerated
 * pretty-printed; what is kept is every sibling field, which the editor never sees and must not lose.
 */
export async function writeSettings(
  root: string,
  text: string,
): Promise<StorageResult<void>> {
  try {
    let settings: unknown;
    try {
      settings = JSON.parse(text);
    } catch (error) {
      return {
        ok: false,
        error: `settings are not JSON: ${(error as Error).message}`,
      };
    }
    if (
      settings === null ||
      typeof settings !== "object" ||
      Array.isArray(settings)
    )
      return { ok: false, error: "settings must be an object" };

    const existing = await readWorkspaceRaw(root);
    const next = {
      schemaVersion: 1,
      name: basename(root) || "workspace",
      ...(existing ?? {}),
      settings,
    };
    await writeFileAtomic(
      join(root, WORKSPACE_FILE),
      `${JSON.stringify(next, null, 2)}\n`,
    );
    return ok(undefined);
  } catch (error) {
    return fail(error);
  }
}

/**
 * Every project in the workspace, newest touched first.
 *
 * A directory without a readable `project.json` is skipped rather than failing the listing. This list is
 * how a person finds their work; one bad file must not be able to hide the rest of it.
 */
export async function listProjects(
  root: string,
): Promise<StorageResult<ProjectSummary[]>> {
  try {
    let entries: string[];
    try {
      entries = await readdir(resolveInside(root, PROJECTS_DIR));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return ok([]);
      throw error;
    }

    const summaries: ProjectSummary[] = [];
    for (const slug of entries.sort()) {
      let file: string;
      try {
        file = join(projectDir(root, slug, PROJECTS_DIR), PROJECT_FILE);
      } catch {
        // Something in `projects/` that is not named like a project. Not ours; leave it alone.
        continue;
      }
      const text = await readText(file).catch(() => null);
      if (text === null) continue;
      let name = slug;
      try {
        const parsed: unknown = JSON.parse(text);
        const candidate = (parsed as { name?: unknown }).name;
        if (typeof candidate !== "string" || candidate.length === 0) continue;
        name = candidate;
      } catch {
        continue;
      }
      const info = await stat(file).catch(() => null);
      summaries.push({ slug, name, updatedAt: info?.mtimeMs ?? 0 });
    }
    return ok(summaries.sort((a, b) => b.updatedAt - a.updatedAt));
  } catch (error) {
    return fail(error);
  }
}

export async function readProject(
  root: string,
  slug: string,
): Promise<StorageResult<string>> {
  try {
    const text = await readText(
      join(projectDir(root, slug, PROJECTS_DIR), PROJECT_FILE),
    );
    if (text === null) return { ok: false, error: `no such project: ${slug}` };
    return ok(text);
  } catch (error) {
    return fail(error);
  }
}

export async function writeProject(
  root: string,
  slug: string,
  text: string,
): Promise<StorageResult<void>> {
  try {
    await writeFileAtomic(
      join(projectDir(root, slug, PROJECTS_DIR), PROJECT_FILE),
      text.endsWith("\n") ? text : `${text}\n`,
    );
    return ok(undefined);
  } catch (error) {
    return fail(error);
  }
}

export async function deleteProject(
  root: string,
  slug: string,
): Promise<StorageResult<void>> {
  try {
    const dir = projectDir(root, slug, PROJECTS_DIR);
    // Refuse to remove a folder that is not a project, so a slug naming something else in `projects/`
    // cannot turn a delete into a much larger delete.
    if ((await readText(join(dir, PROJECT_FILE))) === null)
      return { ok: false, error: `no such project: ${slug}` };
    await rm(dir, { recursive: true, force: true });
    return ok(undefined);
  } catch (error) {
    return fail(error);
  }
}

export async function readSession(
  root: string,
): Promise<StorageResult<string | null>> {
  try {
    return ok(await readText(resolveInside(root, INTERNAL_DIR, SESSION_FILE)));
  } catch (error) {
    return fail(error);
  }
}

export async function writeSession(
  root: string,
  text: string,
): Promise<StorageResult<void>> {
  try {
    await writeFileAtomic(
      resolveInside(root, INTERNAL_DIR, SESSION_FILE),
      text,
    );
    return ok(undefined);
  } catch (error) {
    return fail(error);
  }
}

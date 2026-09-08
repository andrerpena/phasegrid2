import type { WorkspacePointer } from "../../../shared/protocol/workspace";
import { WorkspacePointerSchema } from "../../../shared/protocol/workspace";
import { readSetting, writeSetting } from "../storage/app-storage";

/**
 * Where we were, and where we have been.
 *
 * The one thing that has to live outside a workspace, because something has to remember how to find one.
 * It is deliberately tiny: a path and a short history, and no settings of any kind, so that moving to
 * another machine costs you the recent list and nothing else.
 */

const RECENT_LIMIT = 10;

export async function readPointer(userData: string): Promise<WorkspacePointer> {
  const stored = await readSetting(userData, "workspace");
  if (!stored.ok || stored.value === null) return { path: null, recent: [] };
  try {
    const parsed = WorkspacePointerSchema.safeParse(JSON.parse(stored.value));
    return parsed.success ? parsed.data : { path: null, recent: [] };
  } catch {
    // A pointer file that will not parse means starting at the gate, which is recoverable in one click.
    return { path: null, recent: [] };
  }
}

/** Records a workspace as the current one and moves it to the front of the history. */
export async function rememberWorkspace(
  userData: string,
  root: string,
): Promise<void> {
  const previous = await readPointer(userData);
  const recent = [root, ...previous.recent.filter((p) => p !== root)].slice(
    0,
    RECENT_LIMIT,
  );
  await writeSetting(
    userData,
    "workspace",
    `${JSON.stringify({ path: root, recent }, null, 2)}\n`,
  );
}

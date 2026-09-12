import { useProjectStore } from "@renderer/project/project-store";
import { SessionFileSchema } from "@shared/protocol/workspace";

/**
 * Which projects were open, and which was in front.
 *
 * Kept in the workspace rather than beside the settings, because it is state and not a preference; and
 * kept out of version control by the `.gitignore` the workspace is scaffolded with, because whose tabs
 * were open is one machine's business.
 *
 * Only projects with a slug are recorded. An example has none, and neither does a project that has never
 * been saved: reopening either would mean reopening something that is not on disk.
 */

let timer: ReturnType<typeof setTimeout> | null = null;
let restoring = false;

/** Reopens what was open. The loader is passed in so this file does not have to know the workspace. */
export async function restoreSession(
  open: (slug: string) => Promise<boolean>,
): Promise<void> {
  const read = await window.workspace.readSession();
  if (!read.ok || read.value === null) return;
  let session: ReturnType<typeof SessionFileSchema.parse>;
  try {
    const parsed = SessionFileSchema.safeParse(JSON.parse(read.value));
    if (!parsed.success) return;
    session = parsed.data;
  } catch {
    // A session that will not parse costs you the tabs you had open, which is one click each to
    // recover. It must not cost you the workspace.
    return;
  }

  // Guarded, so reopening ten tabs does not write the session file ten times on the way.
  restoring = true;
  try {
    for (const slug of session.open) await open(slug);
    if (session.active !== null) {
      const target = useProjectStore
        .getState()
        .projects.find((p) => p.slug === session.active);
      if (target !== undefined) useProjectStore.getState().activate(target.id);
    }
  } finally {
    restoring = false;
  }
  await persist();
}

async function persist(): Promise<void> {
  const state = useProjectStore.getState();
  const open = state.projects
    .map((p) => p.slug)
    .filter((s): s is string => s !== undefined && s.length > 0);
  const active =
    state.projects.find((p) => p.id === state.activeId)?.slug ?? null;
  await window.workspace.writeSession(
    `${JSON.stringify({ schemaVersion: 1, open, active }, null, 2)}\n`,
  );
}

/**
 * Writes the session whenever the tabs change.
 *
 * Debounced, because opening a project changes the tab set and then the active tab, and neither of those
 * is worth a separate write to disk.
 */
export function startSessionPersistence(): () => void {
  const stop = useProjectStore.subscribe((state, previous) => {
    if (restoring) return;
    if (
      state.projects === previous.projects &&
      state.activeId === previous.activeId
    )
      return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void persist();
    }, 250);
  });
  return () => {
    stop();
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
}

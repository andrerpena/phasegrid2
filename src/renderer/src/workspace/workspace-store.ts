import { useConfigStore } from "@renderer/config/config-store";
import { useProjectStore } from "@renderer/project/project-store";
import { type ProjectDoc, ProjectDocSchema } from "@shared/protocol/project";
import {
  type ProjectSummary,
  slugify,
  uniqueSlug,
  type WorkspaceInfo,
} from "@shared/protocol/workspace";
import { create } from "zustand";
import { restoreSession } from "./session";

/**
 * The open workspace, and everything that reads or writes it.
 *
 * The renderer never names a path. It picks a workspace through a dialog the main process owns, and
 * thereafter names a project by its slug; the main process is the only side that can turn either into a
 * place on disk. That is not politeness about layering — it is what makes "a project cannot be written
 * outside the workspace" a property of one small file rather than a hope about all of them.
 */

export type WorkspaceStatus = "booting" | "unset" | "ready";

export interface WorkspaceState {
  status: WorkspaceStatus;
  root: string | null;
  name: string;
  projects: ProjectSummary[];
  recent: string[];
  /** The last thing that went wrong, for the gate and the status bar. */
  error: string | null;
}

export interface WorkspaceActions {
  /** Reopens the remembered workspace, or leaves the gate up. Called once, at startup. */
  boot: () => Promise<void>;
  choose: () => Promise<void>;
  openAt: (root: string) => Promise<void>;
  refresh: () => Promise<void>;
  openProject: (slug: string) => Promise<boolean>;
  /** Saves where it already lives, or in a folder named after it. False when it could not be written. */
  saveProject: (id: string) => Promise<boolean>;
  saveProjectAs: (id: string, name: string) => Promise<boolean>;
  removeProject: (slug: string) => Promise<void>;
  /** Every slug in use, on disk or in a tab, so a new one cannot land on top of an old one. */
  takenSlugs: () => string[];
}

export const useWorkspaceStore = create<WorkspaceState & WorkspaceActions>(
  (set, get) => ({
    status: "booting",
    root: null,
    name: "",
    projects: [],
    recent: [],
    error: null,

    boot: async () => {
      const [current, recent] = await Promise.all([
        window.workspace.current(),
        window.workspace.recent(),
      ]);
      set({ recent: recent.ok ? recent.value : [] });
      if (!current.ok || current.value === null) {
        set({ status: "unset" });
        return;
      }
      await adopt(set, get, current.value);
    },

    choose: async () => {
      const chosen = await window.workspace.choose();
      if (!chosen.ok) {
        set({ error: chosen.error });
        return;
      }
      // Cancelled. Nothing changes, including any error already on screen being cleared, because the
      // person did not ask for anything to change.
      if (chosen.value === null) return;
      await adopt(set, get, chosen.value);
    },

    openAt: async (root) => {
      const opened = await window.workspace.openAt(root);
      if (!opened.ok) {
        set({ error: opened.error });
        return;
      }
      await adopt(set, get, opened.value);
    },

    refresh: async () => {
      const listed = await window.workspace.listProjects();
      if (!listed.ok) {
        set({ error: listed.error });
        return;
      }
      set({ projects: listed.value, error: null });
    },

    openProject: async (slug) => {
      const read = await window.workspace.readProject(slug);
      if (!read.ok) {
        set({ error: read.error });
        return false;
      }
      const doc = parseProject(read.value, slug);
      if (doc === null) {
        set({ error: `“${slug}” is not a project this build can read` });
        return false;
      }
      useProjectStore.getState().open(doc);
      // Opening is not a change. Without this the project would be unsaved from the moment it appeared.
      useProjectStore.getState().markClean(doc.id);
      return true;
    },

    saveProject: async (id) => {
      const doc = useProjectStore.getState().snapshot(id);
      if (doc === null) return false;
      // A project that has never been saved is filed under its own name. Asking where to put it would
      // be a question with one sensible answer, and one that has to be answered while quitting.
      const slug =
        doc.slug ?? uniqueSlug(slugify(doc.name), get().takenSlugs());
      return await write(set, get, id, doc, slug, doc.name);
    },

    saveProjectAs: async (id, name) => {
      const doc = useProjectStore.getState().snapshot(id);
      if (doc === null) return false;
      const trimmed = name.trim();
      if (trimmed.length === 0) return false;
      const slug = uniqueSlug(
        slugify(trimmed),
        get()
          .takenSlugs()
          .filter((s) => s !== doc.slug),
      );
      return await write(
        set,
        get,
        id,
        { ...doc, name: trimmed },
        slug,
        trimmed,
      );
    },

    removeProject: async (slug) => {
      const summary = get().projects.find((p) => p.slug === slug);
      const confirmed = await window.workspace.confirmDelete(
        summary?.name ?? slug,
      );
      if (!confirmed.ok || !confirmed.value) return;
      const removed = await window.workspace.deleteProject(slug);
      if (!removed.ok) {
        set({ error: removed.error });
        return;
      }
      // A tab open on the deleted project keeps what is on screen and becomes a project that has never
      // been saved. Deleting a file is not a reason to throw away work nobody asked to lose.
      const open = useProjectStore
        .getState()
        .projects.find((p) => p.slug === slug);
      if (open !== undefined) {
        useProjectStore.setState({
          projects: useProjectStore
            .getState()
            .projects.map((p) =>
              p.id === open.id ? { ...p, slug: undefined } : p,
            ),
        });
        useProjectStore.getState().markDirty(open.id);
      }
      await get().refresh();
    },

    takenSlugs: () => [
      ...get().projects.map((p) => p.slug),
      ...useProjectStore
        .getState()
        .projects.map((p) => p.slug)
        .filter((s): s is string => s !== undefined && s.length > 0),
    ],
  }),
);

type Set = (partial: Partial<WorkspaceState>) => void;
type Get = () => WorkspaceState & WorkspaceActions;

/**
 * Takes on a workspace: its settings, its project list, and the tabs that were open in it.
 *
 * Settings are loaded here rather than at startup because they belong to the folder, so switching
 * folders has to switch them. The keybindings follow from the same read.
 */
async function adopt(set: Set, get: Get, info: WorkspaceInfo): Promise<void> {
  set({
    status: "ready",
    root: info.root,
    name: info.name,
    error: null,
    projects: [],
  });
  await useConfigStore.getState().load();
  await get().refresh();
  const recent = await window.workspace.recent();
  if (recent.ok) set({ recent: recent.value });
  await restoreSession((slug) => get().openProject(slug));
}

/** Reads a project file, refusing anything this build cannot make sense of. */
function parseProject(text: string, slug: string): ProjectDoc | null {
  try {
    const parsed = ProjectDocSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return null;
    // The folder is where the project is, whatever the file may claim, and a project read out of a
    // workspace is by definition not a demonstration.
    return { ...parsed.data, slug, kind: "user" };
  } catch {
    return null;
  }
}

async function write(
  set: Set,
  get: Get,
  id: string,
  doc: ProjectDoc,
  slug: string,
  name: string,
): Promise<boolean> {
  // `slug` is where the project lives and the folder already says so; writing it into the file as well
  // would create a second answer that a rename could make wrong.
  const { slug: _slug, ...payload } = { ...doc, name, kind: "user" as const };
  const validated = ProjectDocSchema.safeParse(payload);
  if (!validated.success) {
    set({ error: `“${name}” cannot be saved: ${validated.error.message}` });
    return false;
  }
  const written = await window.workspace.writeProject(
    slug,
    `${JSON.stringify(validated.data, null, 2)}\n`,
  );
  if (!written.ok) {
    set({ error: written.error });
    return false;
  }
  useProjectStore.getState().located(id, slug, name);
  useProjectStore.getState().markClean(id);
  await get().refresh();
  return true;
}

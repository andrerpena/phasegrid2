import { useConfigStore } from "@renderer/config/config-store";
import {
  type ModuleExample,
  projectFromExample,
} from "@renderer/examples/registry";
import { projectId, useProjectStore } from "@renderer/project/project-store";
import { projectText } from "@renderer/project/project-text";
import { type ProjectDoc, ProjectDocSchema } from "@shared/protocol/project";
import {
  type ProjectSummary,
  slugify,
  uniqueName,
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
  /**
   * Copies an example into the workspace and opens it. False when it could not be written.
   *
   * An example is a starting point, not a document: what lands in the tab is an ordinary project with
   * its own name, its own folder and no restrictions at all. The tab opens either way — a workspace
   * that will not take the copy is a reason to say so, not a reason to throw the copy away.
   */
  copyExample: (example: ModuleExample) => Promise<boolean>;
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

    copyExample: async (example) => {
      const taken = [
        ...get().projects.map((p) => p.name),
        ...useProjectStore.getState().projects.map((p) => p.name),
      ];
      const doc = projectFromExample(
        example,
        uniqueName(example.name, taken),
        projectId(),
      );
      // Opened before it is written, so the canvas shows it whether or not the workspace will take it,
      // and so the save picks the patch up from the same place every other save does.
      useProjectStore.getState().open(doc);
      const saved = await get().saveProject(doc.id);
      // Unsaved work is dirty work. A copy that could not be filed is exactly that, and the tab has to
      // say so rather than looking like something already on disk.
      if (!saved) useProjectStore.getState().markDirty(doc.id);
      return saved;
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
    // The folder is where the project is, whatever the file may claim.
    return { ...parsed.data, slug };
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
  // `slug` is where the project lives and the folder already says so; `projectText` leaves it out,
  // and is the same function the source view shows, so the two can never disagree about the file.
  const text = projectText({ ...doc, name });
  if (!text.ok) {
    set({ error: `“${name}” cannot be saved: ${text.error}` });
    return false;
  }
  const written = await window.workspace.writeProject(slug, text.text);
  if (!written.ok) {
    set({ error: written.error });
    return false;
  }
  useProjectStore.getState().located(id, slug, name);
  useProjectStore.getState().markClean(id);
  await get().refresh();
  return true;
}

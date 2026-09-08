import { useHistoryStore } from "@renderer/history/history-store";
import { usePatchStore } from "@renderer/patch/patch-store";
import { EMPTY_PATCH } from "@shared/protocol/patch";
import {
  DEFAULT_SCALE,
  DEFAULT_TIME_SIGNATURE,
  type ProjectDoc,
  type Scale,
  type TimeSignature,
} from "@shared/protocol/project";
import { create } from "zustand";

/**
 * The open projects, and which one is in front.
 *
 * Several can be open at once, as tabs, but only one can be heard: there is one engine and one pair of
 * ears. So the active project's patch is the document the grid edits and the engine runs, and switching
 * tabs swaps it.
 *
 * The patch store holds that active document rather than this one holding all of them, so the grid,
 * undo and engine synchronisation all keep working on "the current patch" and know nothing about tabs.
 * The price is that switching has to save the outgoing document back here, which `activate` does.
 */

interface ProjectState {
  projects: ProjectDoc[];
  activeId: string | null;
  /**
   * Which projects have work in them that is not on disk.
   *
   * Runtime state, so it lives beside the documents rather than in them: `ProjectDoc` is the thing that
   * gets serialised, and a saved file that remembers it was once unsaved would be nonsense.
   */
  dirtyIds: string[];
}

interface ProjectActions {
  open: (project: ProjectDoc) => void;
  close: (id: string) => void;
  activate: (id: string) => void;
  active: () => ProjectDoc | null;
  setTempo: (tempo: number) => void;
  setTimeSignature: (signature: TimeSignature) => void;
  setScale: (scale: Scale) => void;
  rename: (id: string, name: string) => void;
  /** Whether this project has somewhere to save to. An example never does, until it is saved. */
  canSave: (id: string) => boolean;
  markDirty: (id: string) => void;
  markClean: (id: string) => void;
  isDirty: (id: string) => boolean;
  /**
   * The document as it stands, patch included.
   *
   * The active project's patch lives in the patch store rather than in its record, so reading the
   * record alone would save the patch as it was when the tab was last switched away from. Everything
   * that writes a project to disk goes through here.
   */
  snapshot: (id: string) => ProjectDoc | null;
  /** Records where a project now lives, and that it is a project rather than a demonstration. */
  located: (id: string, slug: string, name?: string) => void;
}

let nextUntitled = 1;

export function emptyProject(name?: string): ProjectDoc {
  const n = nextUntitled++;
  return {
    schemaVersion: 1,
    id: `project-${n}-${Date.now().toString(36)}`,
    name: name ?? (n === 1 ? "Untitled" : `Untitled ${n}`),
    tempo: 120,
    timeSignature: DEFAULT_TIME_SIGNATURE,
    scale: DEFAULT_SCALE,
    patch: EMPTY_PATCH,
    kind: "user",
  };
}

/** Writes the live document back into the project record it belongs to. */
function captureActive(state: ProjectState): ProjectDoc[] {
  if (state.activeId === null) return state.projects;
  const doc = usePatchStore.getState().doc;
  return state.projects.map((p) =>
    p.id === state.activeId ? { ...p, patch: doc } : p,
  );
}

export const useProjectStore = create<ProjectState & ProjectActions>(
  (set, get) => ({
    projects: [],
    activeId: null,
    dirtyIds: [],

    open: (project) => {
      const projects = captureActive(get());
      // Opening a project that is already open brings it forward rather than opening it twice: two tabs
      // of one project would be two documents that quietly disagree.
      const existing = projects.find((p) => p.id === project.id);
      set({
        projects: existing === undefined ? [...projects, project] : projects,
      });
      get().activate(project.id);
    },

    close: (id) => {
      const projects = captureActive(get()).filter((p) => p.id !== id);
      set({ projects, dirtyIds: get().dirtyIds.filter((d) => d !== id) });
      if (get().activeId !== id) return;
      const next = projects.at(-1);
      if (next === undefined) {
        set({ activeId: null });
        usePatchStore.getState().replace(EMPTY_PATCH);
        return;
      }
      set({ activeId: null });
      get().activate(next.id);
    },

    activate: (id) => {
      const state = get();
      if (state.activeId === id) return;
      const projects = captureActive(state);
      const target = projects.find((p) => p.id === id);
      if (target === undefined) return;
      set({ projects, activeId: id });
      // `replace` clears the undo history, which is right: stepping back past a tab switch would undo an
      // edit in a project you are no longer looking at.
      usePatchStore.getState().replace(target.patch);
      useHistoryStore.getState().clear();
    },

    active: () => get().projects.find((p) => p.id === get().activeId) ?? null,

    // Tempo, meter, scale and the name are as much a part of the piece as the wiring is, so changing
    // one is an unsaved change like any other.
    setTempo: (tempo) => {
      const id = get().activeId;
      set({
        projects: get().projects.map((p) =>
          p.id === id ? { ...p, tempo: Math.min(400, Math.max(20, tempo)) } : p,
        ),
      });
      if (id !== null) get().markDirty(id);
    },

    setTimeSignature: (signature) => {
      const id = get().activeId;
      set({
        projects: get().projects.map((p) =>
          p.id === id ? { ...p, timeSignature: signature } : p,
        ),
      });
      if (id !== null) get().markDirty(id);
    },

    setScale: (scale) => {
      const id = get().activeId;
      set({
        projects: get().projects.map((p) =>
          p.id === id ? { ...p, scale } : p,
        ),
      });
      if (id !== null) get().markDirty(id);
    },

    rename: (id, name) => {
      set({
        projects: get().projects.map((p) => (p.id === id ? { ...p, name } : p)),
      });
      get().markDirty(id);
    },

    canSave: (id) => get().projects.find((p) => p.id === id)?.kind === "user",

    markDirty: (id) => {
      if (get().dirtyIds.includes(id)) return;
      set({ dirtyIds: [...get().dirtyIds, id] });
    },

    markClean: (id) =>
      set({ dirtyIds: get().dirtyIds.filter((d) => d !== id) }),

    isDirty: (id) => get().dirtyIds.includes(id),

    snapshot: (id) => {
      const record = get().projects.find((p) => p.id === id);
      if (record === undefined) return null;
      if (id !== get().activeId) return record;
      return { ...record, patch: usePatchStore.getState().doc };
    },

    located: (id, slug, name) =>
      set({
        projects: get().projects.map((p) =>
          p.id === id ? { ...p, slug, kind: "user", name: name ?? p.name } : p,
        ),
      }),
  }),
);

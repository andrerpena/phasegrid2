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
  /** Whether this project has somewhere to save to. An example never does. */
  canSave: (id: string) => boolean;
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
      set({ projects });
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

    setTempo: (tempo) =>
      set({
        projects: get().projects.map((p) =>
          p.id === get().activeId
            ? { ...p, tempo: Math.min(400, Math.max(20, tempo)) }
            : p,
        ),
      }),

    setTimeSignature: (signature) =>
      set({
        projects: get().projects.map((p) =>
          p.id === get().activeId ? { ...p, timeSignature: signature } : p,
        ),
      }),

    setScale: (scale) =>
      set({
        projects: get().projects.map((p) =>
          p.id === get().activeId ? { ...p, scale } : p,
        ),
      }),

    rename: (id, name) =>
      set({
        projects: get().projects.map((p) => (p.id === id ? { ...p, name } : p)),
      }),

    canSave: (id) => get().projects.find((p) => p.id === id)?.kind === "user",
  }),
);

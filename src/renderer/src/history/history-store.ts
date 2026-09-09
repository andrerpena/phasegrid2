import { create } from "zustand";

/**
 * Undo and redo, as pairs of functions.
 *
 * An entry says how to undo itself and how to do it again. Storing that rather than snapshots of the
 * document is what makes undo cheap on a patch of any size, and it is the same vocabulary the engine
 * sync uses, so one user gesture is one entry, one batch to the engine, and one step back.
 *
 * Entries are built from patch operations by the patch store, which means they are also serialisable:
 * a future session could reopen a project with its history intact. Nothing depends on that yet, but
 * closures over live objects would have closed the door on it.
 */

export interface HistoryEntry {
  /** Shown in the history widget, e.g. "Add filter.multi". */
  label: string;
  apply: () => void;
  revert: () => void;
}

export interface HistoryState {
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** While an undo or redo is running, so the change it causes is not recorded as a new entry. */
  applying: boolean;
  limit: number;
}

export interface HistoryActions {
  /** Records an entry. The caller has already made the change; this only remembers how to take it back. */
  push: (entry: HistoryEntry) => void;
  undo: () => void;
  redo: () => void;
  clear: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  /** Runs `fn` without recording anything it does. */
  silently: (fn: () => void) => void;
}

export const useHistoryStore = create<HistoryState & HistoryActions>(
  (set, get) => ({
    past: [],
    future: [],
    applying: false,
    limit: 200,

    push: (entry) => {
      // An undo's own changes must not become entries, or undo would push a redo of itself and the two
      // would never converge.
      if (get().applying) return;
      const past = [...get().past, entry];
      // A bounded history: a long session should not grow without limit, and nobody steps back past a
      // couple of hundred edits.
      if (past.length > get().limit) past.shift();
      // Doing something new discards the redo branch, which is what every editor does and what people
      // expect: the future they were offered was one they chose not to take.
      set({ past, future: [] });
    },

    undo: () => {
      const past = [...get().past];
      const entry = past.pop();
      if (entry === undefined) return;
      set({ applying: true });
      try {
        entry.revert();
      } finally {
        set({ applying: false, past, future: [entry, ...get().future] });
      }
    },

    redo: () => {
      const future = [...get().future];
      const entry = future.shift();
      if (entry === undefined) return;
      set({ applying: true });
      try {
        entry.apply();
      } finally {
        set({ applying: false, future, past: [...get().past, entry] });
      }
    },

    clear: () => set({ past: [], future: [] }),
    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,

    silently: (fn) => {
      const wasApplying = get().applying;
      set({ applying: true });
      try {
        fn();
      } finally {
        set({ applying: wasApplying });
      }
    },
  }),
);

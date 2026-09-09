import { create } from "zustand";

/**
 * What is selected on the grid.
 *
 * The selection lived inside `GridInteraction`, which is where it is made, and nowhere else could see
 * it. That was enough while selecting only changed what the canvas drew, and stopped being enough the
 * moment anything outside the canvas had to act on it: a keybinding cannot ask a Pixi class what is
 * selected, and neither can a command or the inspector.
 *
 * Module ids only. Cables are not hit-tested yet, so there is nothing to put in an edge list; the field
 * is named `modules` rather than `ids` so that edges can join without renaming anything.
 */

export interface SelectionState {
  modules: string[];
  set: (ids: readonly string[]) => void;
  clear: () => void;
  has: (id: string) => boolean;
  isEmpty: () => boolean;
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  modules: [],
  // Identical selections keep the same array, so a subscriber that re-renders on a new reference does
  // not do so every time the same node is clicked again.
  set: (ids) => {
    const current = get().modules;
    if (
      ids.length === current.length &&
      ids.every((id, i) => current[i] === id)
    )
      return;
    set({ modules: [...ids] });
  },
  clear: () => {
    if (get().modules.length === 0) return;
    set({ modules: [] });
  },
  has: (id) => get().modules.includes(id),
  isEmpty: () => get().modules.length === 0,
}));

import { create } from "zustand";

/**
 * Which modals are open.
 *
 * A store rather than component state, because two other things need the answer: the keybinding context
 * asks so a shortcut meant for the grid does not fire while a dialog is up, and the Pixi surfaces ask so
 * they can stop handling pointer input underneath one.
 *
 * A count rather than a flag, since modals can stack.
 */
interface ModalState {
  open: string[];
  isOpen: (id: string) => boolean;
  anyOpen: () => boolean;
  show: (id: string) => void;
  hide: (id: string) => void;
}

export const useModalStore = create<ModalState>((set, get) => ({
  open: [],
  isOpen: (id) => get().open.includes(id),
  anyOpen: () => get().open.length > 0,
  show: (id) =>
    set({ open: get().open.includes(id) ? get().open : [...get().open, id] }),
  hide: (id) => set({ open: get().open.filter((o) => o !== id) }),
}));

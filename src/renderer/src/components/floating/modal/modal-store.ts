import { create } from "zustand";
import type { ModalConfig, ModalInstance } from "./types";

/**
 * The modal stack.
 *
 * A store rather than component state, because three other things need the answer: the keybinding
 * context asks so a shortcut meant for the grid does not fire while a dialog is up, the Pixi
 * surfaces ask so they stop handling pointer input underneath one, and commands open modals from
 * places that have no React tree to render into.
 *
 * A stack rather than a flag, because modals stack, and because "which one is on top" is the
 * question escape has to answer.
 *
 * Two ways in, on purpose. A component that owns its own dialog — the Save As sheet — registers a
 * name with `show`/`hide` and renders itself. A command with no component behind it hands over a
 * whole `ModalConfig` and lets `ModalRenderer` put it on screen. Both end up in the same stack, so
 * `anyOpen` is true for either and escape closes whichever is on top.
 */
export interface ModalState {
  stack: ModalInstance[];
  isOpen: (id: string) => boolean;
  anyOpen: () => boolean;
  /** Opens a modal that renders itself; the id is the name it is known by. */
  show: (id: string) => void;
  /** Closes one, deliberately. Does not run `onDismiss` -- see below. */
  hide: (id: string) => void;
  /** Opens a modal `ModalRenderer` draws. Returns its id so the caller can close it. */
  openModal: (config: ModalConfig) => string;
  closeModal: (id: string) => void;
  closeAllModals: () => void;
  /**
   * Closes one because the user backed out of it: escape, or a click on the backdrop.
   *
   * The distinction from `hide` is the whole reason `onDismiss` exists. Choosing a theme closes the
   * picker *and* keeps the theme; pressing escape closes it *and* puts the old one back. If closing
   * always ran `onDismiss`, the second behaviour would happen in both cases and picking a theme
   * would appear to do nothing.
   */
  dismissModal: (id: string) => void;
}

let counter = 0;

/** Runs a modal's `onDismiss`, if it has one, without letting a throwing one strand the stack. */
function runDismiss(instance: ModalInstance | undefined): void {
  try {
    instance?.onDismiss?.();
  } catch {
    // A dismissal handler that throws is a bug in that handler. Losing the modal layer with it
    // would leave the window covered by a backdrop nothing can remove.
  }
}

export const useModalStore = create<ModalState>((set, get) => ({
  stack: [],

  isOpen: (id) => get().stack.some((m) => m.id === id),
  anyOpen: () => get().stack.length > 0,

  show: (id) => {
    if (get().isOpen(id)) return;
    set({ stack: [...get().stack, { id, content: null }] });
  },

  hide: (id) => set({ stack: get().stack.filter((m) => m.id !== id) }),

  openModal: (config) => {
    counter += 1;
    const id = `modal-${counter}`;
    set({ stack: [...get().stack, { ...config, id }] });
    return id;
  },

  closeModal: (id) => get().hide(id),

  closeAllModals: () => set({ stack: [] }),

  dismissModal: (id) => {
    const instance = get().stack.find((m) => m.id === id);
    set({ stack: get().stack.filter((m) => m.id !== id) });
    runDismiss(instance);
  },
}));

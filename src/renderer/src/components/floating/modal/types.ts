import type { ReactNode } from "react";

export type ModalSize = "sm" | "md" | "lg" | "xl" | "2xl" | "full";
export type ModalAlignment = "center" | "top";

/** What opening a modal takes. Everything but `content` has a sensible default. */
export interface ModalConfig {
  content: ReactNode;
  size?: ModalSize;
  alignment?: ModalAlignment;
  showBackdrop?: boolean;
  /**
   * Called when the modal goes away without the caller closing it: escape, a backdrop click, or
   * `closeAllModals`. This is how a preview is undone — the theme picker repaints the window as you
   * arrow through the list, and needs to put it back if you change your mind.
   */
  onDismiss?: () => void;
}

export interface ModalInstance extends ModalConfig {
  id: string;
}

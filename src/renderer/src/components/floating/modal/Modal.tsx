import { type ReactNode, useEffect, useRef } from "react";
import { cn } from "../../../utils/cn";
import type { ModalAlignment, ModalSize } from "./types";

export interface ModalProps {
  open: boolean;
  /** Backing out: escape, or a click on the backdrop. */
  onClose: () => void;
  children: ReactNode;
  size?: ModalSize;
  alignment?: ModalAlignment;
  showBackdrop?: boolean;
}

/**
 * A modal dialog, built on the platform's own `<dialog>`.
 *
 * Deliberately not a library. `showModal` already gives the things a hand-written dialog usually gets
 * wrong: focus moves inside and is trapped there, escape closes, the rest of the page becomes inert,
 * and it renders in the top layer so no stacking context can cover it. Writing that by hand is how
 * dialogs end up almost accessible.
 *
 * Children are unmounted while closed. That matters more here than in most applications: the piano roll
 * opens in one of these and owns a canvas with a graphics context, which must be released when it
 * closes rather than kept alive off screen.
 */
const sizeClasses: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  full: "max-w-full",
};

const alignmentClasses: Record<ModalAlignment, string> = {
  center: "items-center",
  top: "items-start pt-16",
};

export const Modal = ({
  open,
  onClose,
  children,
  size = "md",
  alignment = "center",
  showBackdrop = true,
}: ModalProps) => {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Closing on a backdrop click, attached to the element rather than declared as a prop.
  //
  // A click on the backdrop lands on the dialog element itself rather than on anything inside it, which
  // is what distinguishes "clicked outside" from "clicked the dialog". It belongs here because it is a
  // fact about the DOM rather than about this component's rendering, and because the keyboard route to
  // the same outcome is escape, which the platform already provides through `cancel`.
  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    const onClick = (event: MouseEvent) => {
      if (event.target === dialog) onClose();
    };
    dialog.addEventListener("click", onClick);
    return () => dialog.removeEventListener("click", onClick);
  }, [onClose]);

  if (!open) return null;

  return (
    <dialog
      ref={ref}
      className={cn(
        // The dialog element is the full-screen layer; the card inside it is what is sized.
        "m-0 h-full max-h-none w-full max-w-none justify-center bg-transparent p-4 open:flex",
        alignmentClasses[alignment],
        showBackdrop ? "backdrop:bg-black/50" : "backdrop:bg-transparent",
      )}
      // Escape fires `cancel`; without this the dialog would close itself while React still believed
      // it was open, and the next open would do nothing.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
    >
      <div className={cn("w-full", sizeClasses[size])} data-kb-scope="modal">
        {children}
      </div>
    </dialog>
  );
};

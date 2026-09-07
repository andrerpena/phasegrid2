import { type ReactNode, useEffect, useRef } from "react";
import styles from "./Modal.module.css";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Buttons along the bottom. */
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "full";
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
export const Modal = ({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
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
      className={`${styles.dialog} ${styles[size]}`}
      // Escape fires `cancel`; without this the dialog would close itself while React still believed
      // it was open, and the next open would do nothing.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      aria-labelledby="modal-title"
    >
      <div className={styles.frame} data-kb-scope="modal">
        <header className={styles.header}>
          <h2 className={styles.title} id="modal-title">
            {title}
          </h2>
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>
        <div className={styles.body}>{children}</div>
        {footer !== undefined && (
          <footer className={styles.footer}>{footer}</footer>
        )}
      </div>
    </dialog>
  );
};

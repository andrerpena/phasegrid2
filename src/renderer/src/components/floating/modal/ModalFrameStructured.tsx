import type { FC, ReactNode } from "react";
import { ModalFrame } from "./ModalFrame";

export interface ModalFrameStructuredProps {
  title: string;
  children: ReactNode;
  /** Buttons along the bottom. */
  footer?: ReactNode;
  onClose?: () => void;
  className?: string;
  "data-testid"?: string;
}

/** The common case: a titled dialog with a close button and a row of buttons under it. */
export const ModalFrameStructured: FC<ModalFrameStructuredProps> = ({
  title,
  children,
  footer,
  onClose,
  className,
  "data-testid": testId,
}) => (
  <ModalFrame className={className} data-testid={testId}>
    <header className="mb-3 flex items-center justify-between gap-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      {onClose !== undefined && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded opacity-60 hover:bg-accent hover:opacity-100"
        >
          <span aria-hidden>×</span>
        </button>
      )}
    </header>
    <div className="text-sm">{children}</div>
    {footer !== undefined && (
      <footer className="mt-4 flex justify-end gap-2">{footer}</footer>
    )}
  </ModalFrame>
);

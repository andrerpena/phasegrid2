import type { FC, ReactNode } from "react";
import { cn } from "../../../utils/cn";

export interface ModalFrameProps {
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}

/** The card a modal's content sits on. Bare, so a caller decides what goes inside it. */
export const ModalFrame: FC<ModalFrameProps> = ({
  children,
  className,
  "data-testid": testId,
}) => (
  <div
    className={cn(
      "rounded-xl border border-border bg-card text-card-foreground p-4 shadow-lg",
      "max-h-[min(600px,calc(100vh-2rem))] overflow-y-auto",
      className,
    )}
    data-testid={testId}
  >
    {children}
  </div>
);

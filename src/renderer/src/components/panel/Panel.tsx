import { cn } from "@renderer/utils/cn";
import type { ReactNode } from "react";

export interface PanelProps {
  children: ReactNode;
  /**
   * The keybinding focus region for anything inside. A binding scoped to this name applies while focus
   * is here, which is how a widget overrides a global shortcut.
   */
  scope?: string;
  /** Off for a panel that fills its slot exactly and draws its own edges — a canvas, an editor. */
  padded?: boolean;
  className?: string;
}

/**
 * The body of a docked widget.
 *
 * It has no title any more: in the dock a widget's name is its tab, and a panel that drew a second
 * heading under the tab strip was saying the same word twice. What is left is the two things a widget
 * body actually needs — somewhere to scroll, and a name for the keyboard to scope bindings to.
 */
export const Panel = ({
  children,
  scope,
  padded = true,
  className,
}: PanelProps) => (
  <div
    className={cn(
      "flex h-full min-h-0 flex-col overflow-auto text-xs",
      padded && "p-2",
      className,
    )}
    data-kb-scope={scope}
  >
    {children}
  </div>
);

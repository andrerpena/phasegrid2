import { commandRegistry } from "@renderer/commands/registry";
import { cn } from "@renderer/utils/cn";
import type { LucideIcon } from "lucide-react";

export interface StatusBarButtonProps {
  text: string;
  icon?: LucideIcon;
  title?: string;
  /** The command a click runs. Without one the item is text rather than a button. */
  commandId?: string;
  onClick?: () => void;
  className?: string;
}

/** One item in the bottom strip. Small, quiet, and clickable when it has somewhere to go. */
export const StatusBarButton = ({
  text,
  icon: Icon,
  title,
  commandId,
  onClick,
  className,
}: StatusBarButtonProps) => {
  const interactive = commandId !== undefined || onClick !== undefined;

  if (!interactive)
    return (
      <span className={cn("flex items-center gap-1", className)} title={title}>
        {Icon !== undefined && <Icon className="h-3 w-3" />}
        {text}
      </span>
    );

  return (
    <button
      type="button"
      title={title}
      className={cn(
        "flex cursor-pointer items-center gap-1 rounded-sm px-1 hover:bg-accent hover:text-accent-foreground",
        className,
      )}
      onClick={() => {
        onClick?.();
        if (commandId !== undefined) void commandRegistry.dispatch(commandId);
      }}
    >
      {Icon !== undefined && <Icon className="h-3 w-3" />}
      {text}
    </button>
  );
};

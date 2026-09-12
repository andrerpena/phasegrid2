import type React from "react";
import { forwardRef } from "react";
import { cn } from "../../utils/cn";

export interface ToggleProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  hasError?: boolean;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

const Toggle = forwardRef<HTMLInputElement, ToggleProps>(
  (
    { className, hasError, checked, onCheckedChange, onChange, ...props },
    ref,
  ) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      onCheckedChange?.(e.target.checked);
      onChange?.(e);
    };

    return (
      <label
        className={cn(
          // Layout & Sizing
          "relative inline-flex h-6 w-11 shrink-0",
          // Alignment
          "items-center",
          // Cursor
          "cursor-pointer",
          // Disabled State
          props.disabled && "cursor-not-allowed opacity-50",
          className,
        )}
      >
        <input
          ref={ref}
          type="checkbox"
          checked={checked}
          onChange={handleChange}
          className="sr-only peer"
          aria-invalid={hasError}
          {...props}
        />
        <div
          className={cn(
            // Layout & Sizing
            "h-6 w-11",
            // Border & Shape
            "rounded-full border-2 border-transparent",
            // Visual Effects
            "shadow-xs outline-none",
            "transition-colors",
            // Unchecked State
            "bg-input",
            // Checked State
            "peer-checked:bg-primary",
            // Focus State
            "peer-focus-visible:border-ring",
            "peer-focus-visible:ring-ring/50 peer-focus-visible:ring-[3px]",
            // Error State
            hasError && [
              "border-destructive",
              "ring-destructive/20",
              "dark:ring-destructive/40",
            ],
          )}
        />
        <div
          className={cn(
            // Position
            "absolute left-0.5",
            // Layout & Sizing
            "pointer-events-none size-5",
            // Shape
            "rounded-full",
            // Background
            "bg-background",
            // Visual Effects
            "shadow-lg ring-0",
            // Animation
            "transition-transform",
            // Position based on state
            checked ? "translate-x-5" : "translate-x-0",
          )}
        />
      </label>
    );
  },
);

Toggle.displayName = "Toggle";

export { Toggle };

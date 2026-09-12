import type React from "react";
import { forwardRef } from "react";
import { cn } from "../../utils/cn";

export interface LabelProps
  extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
}

const Label = forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, required, children, ...props }, ref) => {
    return (
      <label
        ref={ref}
        className={cn(
          "block text-sm font-medium text-foreground",
          required && "after:content-['*'] after:text-destructive after:ml-1",
          className,
        )}
        {...props}
      >
        {children}
      </label>
    );
  },
);

Label.displayName = "Label";

export { Label };

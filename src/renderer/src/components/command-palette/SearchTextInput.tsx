import { Search } from "lucide-react";
import type React from "react";
import { forwardRef } from "react";

export interface SearchTextInputProps
  extends Omit<React.ComponentProps<"input">, "size"> {
  hasError?: boolean;
}

const SearchTextInput = forwardRef<HTMLInputElement, SearchTextInputProps>(
  ({ className, type = "search", hasError, ...props }, ref) => {
    return (
      <div className="relative">
        <input
          ref={ref}
          type={type}
          data-slot="input"
          aria-invalid={hasError}
          className={`
            flex h-9 w-full min-w-0
            pl-10 pr-3 py-1 rounded-md border border-input
            bg-transparent text-base
            shadow-xs outline-none
            transition-[color,box-shadow]
            placeholder:text-muted-foreground
            focus-visible:border-ring
            focus-visible:ring-ring/50 focus-visible:ring-[3px]
            disabled:pointer-events-none
            disabled:cursor-not-allowed
            disabled:opacity-50
            ${className || ""}
          `}
          {...props}
        />
        <div className="absolute top-1/2 left-3 transform -translate-y-1/2 text-muted-foreground pointer-events-none">
          <Search className="h-4 w-4" />
        </div>
      </div>
    );
  },
);

SearchTextInput.displayName = "SearchTextInput";

export { SearchTextInput };

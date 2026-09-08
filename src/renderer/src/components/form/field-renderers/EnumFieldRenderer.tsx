import type React from "react";
import { useRef } from "react";
import type {
  EditFieldLifecycle,
  EditFieldRendererProps,
  EditFieldRendererResult,
} from "./types";

/** Renders an `enum`-flavored field as a native `<select>` driven by
 *  the schema's `metadata.enumValues`. The renderer-factory dispatches
 *  here when `metadata.enumValues` is set, regardless of the
 *  underlying schema type (today only `string`). */
export const EnumFieldRenderer = ({
  fieldState,
  metadata,
  autoFocus,
}: EditFieldRendererProps): EditFieldRendererResult => {
  const selectRef = useRef<HTMLSelectElement>(null);

  const lifecycle: EditFieldLifecycle = {
    onEnterEdit: () => {
      // Defer focus so the select has mounted; matches the
      // String/Number renderers' pattern.
      setTimeout(() => {
        if (autoFocus) selectRef.current?.focus();
      }, 0);
    },
  };

  const options = metadata.enumValues ?? [];

  const element = (
    <select
      ref={selectRef}
      id={fieldState.name}
      name={fieldState.name}
      onBlur={fieldState.handleBlur}
      value={String(fieldState.state.value ?? "")}
      onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
        fieldState.handleChange(e.target.value)
      }
      className="h-8 w-full rounded border border-border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {options.map((opt) => (
        <option key={String(opt.value)} value={String(opt.value)}>
          {opt.label}
        </option>
      ))}
    </select>
  );

  return { element, lifecycle, autoCommit: true };
};

import { useMemo, useState } from "react";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import type {
  BaseSchema,
  ObjectSchema,
  ObjectShape,
} from "../../schemas/core/schema";
import { TextInput } from "../form-controls/TextInput";
import { FormFieldRenderer } from "./FormFieldRenderer";
import { SchemaFormLabelSplitter } from "./SchemaFormLabelSplitter";
import { SchemaFormLayoutProvider } from "./SchemaFormLayoutContext";
import type { SchemaFormConfiguration } from "./useSchemaForm";

interface SchemaFormBodyProps {
  form: SchemaFormConfiguration<ObjectSchema<ObjectShape>>;
  className?: string;
  /** Whether to auto-focus the first field */
  autoFocusFirst?: boolean;
  /** Render mode passed through to FormFieldRenderer. Defaults to
   *  "edit" — the inspector wants every field interactive by default,
   *  with per-field opt-out via `metadata.editable: false`. */
  mode?: "edit" | "view";
}

/**
 * Renders all fields from an ObjectSchema using TanStack Form.
 * Each field is rendered with horizontal label layout via FormControl.
 * The label-column width is resizable via a draggable splitter.
 */
export function SchemaFormBody({
  form,
  className = "",
  autoFocusFirst = true,
  mode = "edit",
}: SchemaFormBodyProps) {
  const { schema } = form;
  const shape = schema.getShape();
  const fieldKeys = Object.keys(shape);

  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 200);

  // Case-insensitive substring match against each field's label (falling back
  // to the key name) and its description. Filtering only hides fields from the
  // DOM — the TanStack fields stay registered, so values survive on submit.
  const visibleKeys = useMemo(() => {
    const normalized = debouncedQuery.trim().toLowerCase();
    if (!normalized) return fieldKeys;

    return fieldKeys.filter((fieldName) => {
      const meta = (shape[fieldName] as BaseSchema<unknown>)._meta;
      const label = meta.label ?? fieldName;
      const description = meta.description ?? "";
      return `${label} ${description}`.toLowerCase().includes(normalized);
    });
  }, [fieldKeys, shape, debouncedQuery]);

  return (
    <SchemaFormLayoutProvider>
      <div className={`relative flex flex-col ${className}`}>
        <TextInput
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search fields…"
          aria-label="Search fields"
          className="mb-2"
        />
        <SchemaFormLabelSplitter />
        {visibleKeys.length === 0 ? (
          <div className="py-2 text-sm text-muted-foreground">
            No matching fields
          </div>
        ) : (
          <div className="flex-1 space-y-2">
            {visibleKeys.map((fieldName, index) => {
              const fieldSchema = shape[fieldName] as BaseSchema<unknown>;
              const isFirstField = index === 0;

              return (
                <div key={fieldName}>
                  <form.api.Field name={fieldName}>
                    {(fieldState) => (
                      <FormFieldRenderer
                        schema={fieldSchema}
                        fieldState={fieldState}
                        metadata={fieldSchema._meta}
                        autoFocus={autoFocusFirst && isFirstField}
                        mode={mode}
                      />
                    )}
                  </form.api.Field>
                  {/* Separator between fields */}
                  {index < visibleKeys.length - 1 && (
                    <div className="border-t border-border my-2" />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </SchemaFormLayoutProvider>
  );
}

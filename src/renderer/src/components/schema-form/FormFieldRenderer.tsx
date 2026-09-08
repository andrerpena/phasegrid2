// =============================================================================
// FORM FIELD RENDERER COMPONENT
// =============================================================================

import type {
  BaseSchema,
  OptionalSchema,
  SchemaMetadata,
} from "../../schemas/core/schema";
import { resolveRenderer } from "./renderer-factory";

interface FormFieldRendererProps {
  /** The schema for this field */
  schema: BaseSchema<unknown>;
  /** Field name/key */
  fieldName: string;
  /** Current value */
  value: unknown;
  /** Callback when value changes */
  onChange?: (value: unknown) => void;
}

/**
 * Renders a single form field based on its schema
 */
export function FormFieldRenderer({
  schema,
  fieldName,
  value,
  onChange,
}: FormFieldRendererProps) {
  // Unwrap optional schema to get the actual type
  let actualSchema = schema;
  if (schema.type === "optional") {
    actualSchema = (schema as OptionalSchema<BaseSchema<unknown>>).unwrap();
  }

  const metadata: SchemaMetadata<unknown> = {
    ...actualSchema._meta,
    ...schema._meta, // Optional schema metadata can override
  };

  // Get the label with fallback
  const label = metadata.label ?? formatFieldName(fieldName);

  // Resolve the renderer
  const Renderer = resolveRenderer(metadata.renderer, actualSchema.type);

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </label>
      <div className="min-h-[24px] flex items-center">
        <Renderer
          schema={actualSchema}
          value={value}
          metadata={metadata}
          fieldName={fieldName}
          onChange={onChange}
        />
      </div>
    </div>
  );
}

/**
 * Format a camelCase or snake_case field name as a readable label
 */
function formatFieldName(name: string): string {
  return (
    name
      // Split on camelCase
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      // Split on snake_case
      .replace(/_/g, " ")
      // Capitalize first letter of each word
      .replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

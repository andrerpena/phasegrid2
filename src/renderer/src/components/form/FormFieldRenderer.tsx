import type { AnyFieldApi } from "@tanstack/react-form";
import type { BaseSchema, SchemaMetadata } from "../../schemas/core/schema";
import { OptionalSchema } from "../../schemas/core/schema";
import {
  createFieldRenderer,
  type FormFieldRendererContext,
} from "./field-renderers/renderer-factory";

export interface FormFieldRendererProps {
  schema: BaseSchema<unknown>;
  fieldState: AnyFieldApi;
  metadata: SchemaMetadata<unknown>;
  mode?: "edit" | "view" | "patch";
  /** Whether this field should be auto-focused on mount */
  autoFocus?: boolean;
}

/**
 * Renders a form field based on the schema type.
 * Includes FormControl wrapper with horizontal label layout.
 */
export function FormFieldRenderer({
  schema,
  fieldState,
  metadata,
  mode = "edit",
  autoFocus,
}: FormFieldRendererProps) {
  const hasError =
    fieldState.state.meta.isTouched && !fieldState.state.meta.isValid;
  const isRequired = !(schema instanceof OptionalSchema);

  // Unwrap optional schema to get the actual schema for rendering
  const schemaToRender =
    schema instanceof OptionalSchema ? schema.unwrap() : schema;

  // Merge metadata from wrapped schema if optional
  const mergedMetadata =
    schema instanceof OptionalSchema
      ? { ...schemaToRender._meta, ...metadata }
      : metadata;

  const context: FormFieldRendererContext = {
    schema: schemaToRender,
    fieldState,
    metadata: mergedMetadata,
    hasError,
    isRequired,
    autoFocus,
  };

  return createFieldRenderer(mode, context);
}

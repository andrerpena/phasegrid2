// =============================================================================
// SCHEMA FORM TYPES
// =============================================================================

import type {
  BaseSchema,
  ObjectSchema,
  ObjectShape,
  SchemaMetadata,
} from "../../schemas/core/schema";

/**
 * Props for field renderers
 */
export interface FieldRendererProps {
  /** The schema for this field */
  schema: BaseSchema<unknown>;
  /** The current value */
  value: unknown;
  /** Field metadata */
  metadata: SchemaMetadata<unknown>;
  /** Field name/key */
  fieldName: string;
  /** Callback when value changes (for editable fields) */
  onChange?: (value: unknown) => void;
}

/**
 * A field renderer function
 */
export type FieldRenderer = (props: FieldRendererProps) => React.ReactElement;

/**
 * Registry of field renderers by renderer name or schema type
 */
export interface FieldRendererRegistry {
  /** Renderers by custom renderer name (e.g., "enum", "percentage") */
  byName: Record<string, FieldRenderer>;
  /** Renderers by schema type (e.g., "string", "number", "boolean") */
  byType: Record<string, FieldRenderer>;
}

/**
 * Props for the InspectorForm component
 */
export interface InspectorFormProps<TShape extends ObjectShape> {
  /** The object schema defining the form structure */
  schema: ObjectSchema<TShape>;
  /** Current data values */
  data: Partial<Record<keyof TShape, unknown>>;
  /** Layout name to use (defaults to "default") */
  layout?: string;
  /** Callback when a field value changes */
  onChange?: (fieldName: keyof TShape, value: unknown) => void;
}

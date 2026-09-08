import type { AnyFieldApi } from "@tanstack/react-form";
import type { BaseSchema, SchemaMetadata } from "../../../schemas/core/schema";
import { FormControl } from "../../form-controls";
import { BooleanFieldRenderer } from "./BooleanFieldRenderer";
import { ColorFieldRenderer } from "./ColorFieldRenderer";
import { EnumFieldRenderer } from "./EnumFieldRenderer";
import { NumberFieldRenderer } from "./NumberFieldRenderer";
import { ReadOnlyFieldRenderer } from "./ReadOnlyFieldRenderer";
import { StringFieldRenderer } from "./StringFieldRenderer";
import type { EditFieldRenderer, EditFieldRendererMap } from "./types";

/**
 * Unsupported field renderer - shows a placeholder for unknown schema types.
 */
const UnsupportedFieldRenderer: EditFieldRenderer = ({ schema }) => {
  const element = (
    <div className="text-muted-foreground text-sm italic">
      Unsupported field type: {schema.type}
    </div>
  );
  return { element };
};

/**
 * Map of schema type to edit field renderer.
 */
const editFieldRenderers: EditFieldRendererMap = {
  string: StringFieldRenderer,
  number: NumberFieldRenderer,
  boolean: BooleanFieldRenderer,
};

/**
 * Resolves the appropriate edit renderer for the given context. The
 * enum override takes priority: any field whose metadata declares
 * `enumValues` renders as a select, regardless of the underlying
 * schema type. Otherwise we dispatch by schema type as before.
 */
const resolveEditRenderer = (
  schemaType: string,
  metadata: SchemaMetadata<unknown>,
): EditFieldRenderer => {
  // Explicit renderer override wins first — a `renderer: "color"` field
  // gets the color swatch regardless of its underlying (string) type.
  if (metadata.renderer === "color") {
    return ColorFieldRenderer;
  }
  if (metadata.enumValues && metadata.enumValues.length > 0) {
    return EnumFieldRenderer;
  }
  if (editFieldRenderers[schemaType]) {
    return editFieldRenderers[schemaType];
  }
  return UnsupportedFieldRenderer;
};

/**
 * Context for field rendering.
 */
export interface FormFieldRendererContext {
  schema: BaseSchema<unknown>;
  fieldState: AnyFieldApi;
  metadata: SchemaMetadata<unknown>;
  hasError: boolean;
  isRequired: boolean;
  /** Whether this field should be auto-focused on mount */
  autoFocus?: boolean;
}

/**
 * Creates the raw edit field element (without FormControl wrapper).
 */
const createRawEditRenderer = (context: FormFieldRendererContext) => {
  const renderer = resolveEditRenderer(context.schema.type, context.metadata);
  return renderer({
    schema: context.schema,
    fieldState: context.fieldState,
    hasError: context.hasError,
    metadata: context.metadata,
    autoFocus: context.autoFocus,
  });
};

/**
 * Creates an edit field wrapped in FormControl with label, hint, and validation.
 */
export const createEditRenderer = (context: FormFieldRendererContext) => {
  const result = createRawEditRenderer(context);

  const element = (
    <FormControl
      label={context.metadata.label}
      hint={context.metadata.description}
      field={context.fieldState}
      required={context.isRequired}
    >
      {result.element}
    </FormControl>
  );

  return { element, lifecycle: result.lifecycle };
};

/**
 * Per-field read-only renderer: shows the value as plain text inside
 * the standard FormControl frame (so the label column + spacing stay
 * aligned with editable rows).
 */
const createReadOnlyRenderer = (context: FormFieldRendererContext) => {
  const element = (
    <FormControl
      label={context.metadata.label}
      hint={context.metadata.description}
      field={context.fieldState}
      required={false}
    >
      <ReadOnlyFieldRenderer
        value={context.fieldState.state.value}
        metadata={context.metadata}
      />
    </FormControl>
  );
  return { element };
};

/**
 * Creates a field renderer for the given context.
 *
 * Modes:
 *  - `edit` (default): editable input, wrapped in FormControl.
 *  - `view`: every field is read-only (used by an external view-only
 *    surface; not needed by the inspector today).
 *
 * Per-field override: when `metadata.editable === false`, the field
 * always renders as read-only regardless of mode. That's how the
 * inspector keeps `id` / `x` / `y` / etc. non-editable while leaving
 * `lightState` and `availableTrucks` interactive in the same form.
 */
export const createFieldRenderer = (
  mode: string,
  context: FormFieldRendererContext,
) => {
  const isExplicitlyReadOnly = context.metadata.editable === false;
  if (mode === "view" || isExplicitlyReadOnly) {
    return createReadOnlyRenderer(context).element;
  }
  return createEditRenderer(context).element;
};

// =============================================================================
// INSPECTOR FORM COMPONENT
// =============================================================================

import type { ObjectSchema, ObjectShape } from "../../schemas/core/schema";
import { FormFieldRenderer } from "./FormFieldRenderer";

interface InspectorFormProps<TShape extends ObjectShape> {
  /** The object schema defining the form structure */
  schema: ObjectSchema<TShape>;
  /** Current data values */
  data: Partial<Record<keyof TShape, unknown>>;
  /** Layout name to use (defaults to "default") */
  layout?: string;
  /** Callback when a field value changes */
  onChange?: (fieldName: keyof TShape, value: unknown) => void;
}

/**
 * Renders a schema-based inspector form
 *
 * Uses the schema's layout configuration to organize fields into groups,
 * rendering each field with the appropriate renderer based on its type.
 */
export function InspectorForm<TShape extends ObjectShape>({
  schema,
  data,
  layout: layoutName = "default",
  onChange,
}: InspectorFormProps<TShape>) {
  const layout = schema.getLayout(layoutName);

  // If no layout defined, render all fields in a simple list
  if (!layout) {
    return (
      <div className="flex flex-col gap-4 p-2">
        {schema.getFieldKeys().map((key) => (
          <FormFieldRenderer
            key={String(key)}
            schema={schema.getFieldSchema(key)}
            fieldName={String(key)}
            value={data[key]}
            onChange={onChange ? (v) => onChange(key, v) : undefined}
          />
        ))}
      </div>
    );
  }

  // Render using the layout's groups
  return (
    <div className="flex flex-col gap-4">
      {layout.groups.map((group, groupIndex) => (
        <FormGroup key={group.label ?? groupIndex} label={group.label}>
          <div className="grid grid-cols-12 gap-x-3 gap-y-3">
            {group.fields
              .filter((field) => !field.hidden)
              .map((field) => (
                <div
                  key={String(field.name)}
                  className={`col-span-${field.fieldWidth ?? 12}`}
                  style={{
                    gridColumn: `span ${field.fieldWidth ?? 12} / span ${field.fieldWidth ?? 12}`,
                  }}
                >
                  <FormFieldRenderer
                    schema={schema.getFieldSchema(field.name)}
                    fieldName={String(field.name)}
                    value={data[field.name]}
                    onChange={
                      onChange ? (v) => onChange(field.name, v) : undefined
                    }
                  />
                </div>
              ))}
          </div>
        </FormGroup>
      ))}
    </div>
  );
}

/**
 * A labeled group of form fields
 */
function FormGroup({
  label,
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      {label && (
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider border-b border-border pb-1">
          {label}
        </h3>
      )}
      <div className="px-1">{children}</div>
    </div>
  );
}

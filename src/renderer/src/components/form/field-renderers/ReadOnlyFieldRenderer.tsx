import type { SchemaMetadata } from "../../../schemas/core/schema";

export interface ReadOnlyFieldRendererProps {
  value: unknown;
  metadata: SchemaMetadata<unknown>;
}

/** Renders a schema field's value as plain, non-editable text.
 *
 *  Used by the inspector form when a field's metadata has
 *  `editable: false` — e.g. structure id / definitionId / position /
 *  derived counts. The styling is intentionally close to the input
 *  field's height so toggling between read-only and editable fields
 *  doesn't make the row jump. */
export const ReadOnlyFieldRenderer = ({
  value,
  metadata,
}: ReadOnlyFieldRendererProps) => {
  const display = formatValue(value);
  const suffix = metadata.unit ? ` ${metadata.unit}` : "";
  const isEmpty = display === "";
  return (
    <div
      className="min-h-[2rem] py-1 text-sm text-foreground"
      data-component="ReadOnlyField"
    >
      {isEmpty ? (
        <span className="text-muted-foreground italic">empty</span>
      ) : (
        <span>
          {display}
          {suffix}
        </span>
      )}
    </div>
  );
};

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value))
    return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (typeof value === "object") {
    const keys = Object.keys(value as object);
    return `${keys.length} entr${keys.length === 1 ? "y" : "ies"}`;
  }
  return String(value);
}

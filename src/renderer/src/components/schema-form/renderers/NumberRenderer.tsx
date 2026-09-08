// =============================================================================
// NUMBER FIELD RENDERER
// =============================================================================

import type { FieldRendererProps } from "../types";

/**
 * Renders a number field value
 */
export function NumberRenderer({ value, metadata }: FieldRendererProps) {
  const numValue = typeof value === "number" ? value : 0;
  const unit = metadata.unit ?? "";

  // Format the number with appropriate precision
  const displayValue = Number.isInteger(numValue)
    ? numValue.toString()
    : numValue.toFixed(2);

  return (
    <span className="text-sm text-foreground tabular-nums">
      {displayValue}
      {unit && <span className="text-muted-foreground ml-1">{unit}</span>}
    </span>
  );
}

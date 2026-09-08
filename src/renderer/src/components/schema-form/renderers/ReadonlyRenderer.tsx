// =============================================================================
// READONLY FIELD RENDERER
// =============================================================================

import type { FieldRendererProps } from "../types";

/**
 * Renders a readonly text value (no editing)
 */
export function ReadonlyRenderer({ value, metadata }: FieldRendererProps) {
  const displayValue = value != null ? String(value) : "—";
  const unit = metadata.unit ?? "";

  return (
    <span className="text-sm text-muted-foreground font-mono">
      {displayValue}
      {unit && <span className="ml-1">{unit}</span>}
    </span>
  );
}

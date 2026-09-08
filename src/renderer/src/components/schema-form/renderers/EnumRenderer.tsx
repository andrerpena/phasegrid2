// =============================================================================
// ENUM FIELD RENDERER
// =============================================================================

import type { FieldRendererProps } from "../types";

/**
 * Renders an enum field value with label lookup
 */
export function EnumRenderer({ value, metadata }: FieldRendererProps) {
  const enumValues = metadata.enumValues ?? [];

  // Find the matching option
  const option = enumValues.find((opt) => opt.value === value);
  const displayValue = option?.label ?? String(value ?? "—");

  return <span className="text-sm text-foreground">{displayValue}</span>;
}

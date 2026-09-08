// =============================================================================
// BOOLEAN FIELD RENDERER
// =============================================================================

import type { FieldRendererProps } from "../types";

/**
 * Renders a boolean field value
 */
export function BooleanRenderer({ value }: FieldRendererProps) {
  const boolValue = Boolean(value);

  return (
    <span
      className={`text-sm font-medium ${
        boolValue
          ? // The theme's own roles: a literal green would survive a theme switch and a palette
            // change, which is the thing the token indirection exists to prevent.
            "text-signal-note"
          : "text-destructive"
      }`}
    >
      {boolValue ? "Yes" : "No"}
    </span>
  );
}

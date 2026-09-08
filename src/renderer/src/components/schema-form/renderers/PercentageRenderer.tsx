// =============================================================================
// PERCENTAGE FIELD RENDERER
// =============================================================================

import type { FieldRendererProps } from "../types";

/**
 * Renders a percentage value (0-1 as 0-100%)
 */
export function PercentageRenderer({ value }: FieldRendererProps) {
  const numValue = typeof value === "number" ? value : 0;
  // Convert 0-1 to percentage
  const percentage = Math.round(numValue * 100);

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-ring rounded-full transition-all"
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="text-sm text-foreground tabular-nums w-12 text-right">
        {percentage}%
      </span>
    </div>
  );
}

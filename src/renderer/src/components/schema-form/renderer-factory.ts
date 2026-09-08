// =============================================================================
// RENDERER FACTORY
// =============================================================================

import {
  BooleanRenderer,
  EnumRenderer,
  NumberRenderer,
  PercentageRenderer,
  ReadonlyRenderer,
  StringRenderer,
} from "./renderers";
import type { FieldRenderer, FieldRendererRegistry } from "./types";

/**
 * Default renderer registry with built-in renderers
 */
export const defaultRendererRegistry: FieldRendererRegistry = {
  // Custom renderers by name
  byName: {
    enum: EnumRenderer,
    percentage: PercentageRenderer,
    readonly: ReadonlyRenderer,
  },

  // Renderers by schema type
  byType: {
    string: StringRenderer,
    number: NumberRenderer,
    boolean: BooleanRenderer,
    optional: StringRenderer, // Fallback for optional types
  },
};

/**
 * Resolve the appropriate renderer for a field
 *
 * Resolution priority:
 * 1. Custom renderer by name (from metadata.renderer)
 * 2. Type-based renderer (from schema.type)
 * 3. Fallback to string renderer
 */
export function resolveRenderer(
  rendererName: string | undefined,
  schemaType: string,
  registry: FieldRendererRegistry = defaultRendererRegistry,
): FieldRenderer {
  // 1. Try custom renderer by name
  if (rendererName && registry.byName[rendererName]) {
    return registry.byName[rendererName];
  }

  // 2. Try type-based renderer
  if (registry.byType[schemaType]) {
    return registry.byType[schemaType];
  }

  // 3. Fallback to string renderer
  return StringRenderer;
}

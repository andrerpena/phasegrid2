import type { WidgetDefinition, WidgetId } from "./types";

/**
 * Every widget the build knows how to draw.
 *
 * A registry rather than a switch statement, because the layout is data in a settings file: a slot
 * holds a list of names, and something has to turn a name into a component. Registering twice
 * overwrites, so hot reload replaces a definition rather than accumulating them.
 */
class WidgetRegistry {
  private readonly widgets = new Map<WidgetId, WidgetDefinition>();

  register(definition: WidgetDefinition): void {
    this.widgets.set(definition.id, definition);
  }

  /** Takes a string, because the caller is usually a name out of a settings file. */
  get(id: string): WidgetDefinition | undefined {
    return this.widgets.get(id as WidgetId);
  }

  has(id: string): boolean {
    return this.widgets.has(id as WidgetId);
  }

  all(): WidgetDefinition[] {
    return [...this.widgets.values()];
  }

  clear(): void {
    this.widgets.clear();
  }
}

export const widgetRegistry = new WidgetRegistry();

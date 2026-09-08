import type { StatusBarId, StatusBarItemDefinition } from "./types";

/** The same shape as the widget registry, for the strip along the bottom. */
class StatusBarRegistry {
  private readonly items = new Map<StatusBarId, StatusBarItemDefinition>();

  register(definition: StatusBarItemDefinition): void {
    this.items.set(definition.id, definition);
  }

  get(id: string): StatusBarItemDefinition | undefined {
    return this.items.get(id as StatusBarId);
  }

  has(id: string): boolean {
    return this.items.has(id as StatusBarId);
  }

  all(): StatusBarItemDefinition[] {
    return [...this.items.values()];
  }

  clear(): void {
    this.items.clear();
  }
}

export const statusBarRegistry = new StatusBarRegistry();

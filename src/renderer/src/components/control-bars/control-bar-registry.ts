import type { ControlBarDefinition, ControlBarId } from "./types";

/** The same shape as the widget and status-bar registries, for the controls over the canvas. */
class ControlBarRegistry {
  private readonly bars = new Map<ControlBarId, ControlBarDefinition>();

  register(definition: ControlBarDefinition): void {
    this.bars.set(definition.id, definition);
  }

  get(id: string): ControlBarDefinition | undefined {
    return this.bars.get(id as ControlBarId);
  }

  has(id: string): boolean {
    return this.bars.has(id as ControlBarId);
  }

  all(): ControlBarDefinition[] {
    return [...this.bars.values()];
  }

  clear(): void {
    this.bars.clear();
  }
}

export const controlBarRegistry = new ControlBarRegistry();

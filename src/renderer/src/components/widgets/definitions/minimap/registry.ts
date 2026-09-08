import type { MinimapDrawer } from "./types";

/**
 * Everything that paints itself on the minimap.
 *
 * A registry, so the minimap knows nothing about what is in a patch. Adding something drawable to
 * the canvas means adding a drawer here rather than editing the minimap, which is what keeps the
 * dependency one-way: minimap → patch, never the reverse.
 */
class MinimapDrawerRegistry {
  private readonly drawers = new Map<string, MinimapDrawer>();

  register(drawer: MinimapDrawer): void {
    this.drawers.set(drawer.id, drawer);
  }

  /** In registration order, which is paint order: later drawers cover earlier ones. */
  all(): MinimapDrawer[] {
    return [...this.drawers.values()];
  }

  clear(): void {
    this.drawers.clear();
  }
}

export const minimapDrawerRegistry = new MinimapDrawerRegistry();

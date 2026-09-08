import { cablesDrawer } from "./cables-drawer";
import { modulesDrawer } from "./modules-drawer";
import { minimapDrawerRegistry } from "./registry";

/**
 * Registration order is paint order.
 *
 * Cables first, so a module covers the cable that reaches it and the connection reads as plugged in
 * rather than as a line crossing over a box.
 */
export function registerBuiltInMinimapDrawers(): void {
  minimapDrawerRegistry.register(cablesDrawer);
  minimapDrawerRegistry.register(modulesDrawer);
}

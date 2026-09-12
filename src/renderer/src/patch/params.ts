import type { ModuleDescriptor } from "@shared/protocol/catalog";
import type { PatchModule } from "@shared/protocol/patch";

/**
 * What a parameter is currently set to.
 *
 * The patch document holds every parameter value, including the ones passing under a hand mid-drag,
 * and this is how they are read. One accessor rather than one per view: a knob, the inspector and
 * anything else that draws a value have to agree about what happens when the document does not mention
 * a parameter, and three copies of that rule are three chances to disagree.
 *
 * Pure functions over plain data, taking the module rather than the store, so a Pixi component can use
 * them without reaching for a store it is not allowed to know about.
 */

/** The module's own value, or the descriptor's default when it has never been set. */
export function paramValue(
  module: PatchModule | undefined,
  descriptor: ModuleDescriptor,
  paramId: string,
): number {
  const explicit = module?.params?.[paramId];
  return explicit ?? paramDefault(descriptor, paramId);
}

/** What the engine would use if nobody had touched it. Zero for a parameter this module has no such. */
export function paramDefault(
  descriptor: ModuleDescriptor,
  paramId: string,
): number {
  return descriptor.params.find((p) => p.id === paramId)?.default ?? 0;
}

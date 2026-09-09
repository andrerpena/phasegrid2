import { useCatalogStore } from "@renderer/catalog/catalog-store";
import { SearchableTreeNavigator } from "@renderer/components/command-palette";
import { composeFace } from "@renderer/grid/face";
import type { MenuItem } from "@renderer/menu/types";
import { addModuleOp } from "@renderer/patch/add-module";
import { usePatchStore } from "@renderer/patch/patch-store";
import type { ModuleDescriptor } from "@shared/protocol/catalog";
import { useMemo } from "react";

/**
 * Every module the engine has, grouped by category. Choosing one adds it to the patch.
 *
 * The list is built entirely from the engine's descriptors, so a module added to the engine appears
 * here with its name, category and documentation and nothing in the interface changes.
 */

/** Where a module dropped from the catalogue lands, until there is a cursor to drop it at. */
const DROP_AT = { x: 48, y: 48 };
/** A type the catalogue does not know still needs a size, or every unknown module would be placed
 *  at the origin on top of the others. */
const UNKNOWN_SIZE = { width: 144, height: 96 };

function addModule(descriptor: ModuleDescriptor): void {
  const sizeOf = (type: string) => {
    const found = useCatalogStore.getState().get(type);
    if (found === undefined) return UNKNOWN_SIZE;
    const face = composeFace(found);
    return { width: face.width, height: face.height };
  };
  const doc = usePatchStore.getState().doc;
  usePatchStore
    .getState()
    .apply([addModuleOp(doc, descriptor, sizeOf, DROP_AT)], {
      label: `Add ${descriptor.name}`,
    });
}

export const CatalogPanel = () => {
  const modules = useCatalogStore((s) => s.modules);
  const status = useCatalogStore((s) => s.status);
  const error = useCatalogStore((s) => s.error);

  // Categories are the tree's parents, so the list reads as headings with modules under them and a
  // category can be folded away. Sorted, because the engine returns them in registration order and a
  // catalogue that reorders itself between builds is one you cannot learn the shape of.
  const items = useMemo<MenuItem[]>(() => {
    const byCategory = new Map<string, MenuItem[]>();
    for (const m of modules) {
      const category = m.category === "" ? "Other" : m.category;
      const bucket = byCategory.get(category) ?? [];
      bucket.push({
        id: m.id,
        label: m.name,
        trailing: m.id,
        keywords: m.doc,
        onExecute: () => {
          const descriptor = useCatalogStore.getState().get(m.id);
          if (descriptor !== undefined) addModule(descriptor);
        },
      });
      byCategory.set(category, bucket);
    }
    return [...byCategory.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, children]) => ({
        id: `category:${category}`,
        label: category.toUpperCase(),
        children: children.sort((a, b) =>
          (a.label ?? "").localeCompare(b.label ?? ""),
        ),
      }));
  }, [modules]);

  const expanded = useMemo(() => items.map((i) => i.id), [items]);

  if (status === "error")
    return (
      <p className="m-0 p-2 text-xs text-muted-foreground">
        Catalogue unavailable: {error}
      </p>
    );
  if (status !== "ready")
    return (
      <p className="m-0 p-2 text-xs text-muted-foreground">
        Loading the catalogue…
      </p>
    );

  return (
    <div className="h-full p-2">
      <SearchableTreeNavigator
        items={items}
        placeHolder="Search modules"
        defaultExpandedIds={expanded}
        height="full"
        data-testid="catalog"
      />
    </div>
  );
};

import { useCatalogStore } from "@renderer/catalog/catalog-store";
import {
  type NavigatorItem,
  SearchableTreeNavigator,
} from "@renderer/components/command-palette/SearchableTreeNavigator";
import { measureNode } from "@renderer/grid/layout";
import { addModuleOp } from "@renderer/patch/add-module";
import { usePatchStore } from "@renderer/patch/patch-store";
import { useMemo } from "react";
import styles from "./CatalogPanel.module.css";

/**
 * Every module the engine has, grouped by category. Choosing one adds it to the patch.
 *
 * The list is built entirely from the engine's descriptors, so a module added to the engine appears
 * here with its name, category and documentation and nothing in the interface changes.
 */
export const CatalogPanel = () => {
  const modules = useCatalogStore((s) => s.modules);
  const status = useCatalogStore((s) => s.status);
  const error = useCatalogStore((s) => s.error);

  const items = useMemo<NavigatorItem[]>(
    () =>
      modules.map((m) => ({
        id: m.id,
        label: m.name,
        hint: m.id,
        group: m.category,
        keywords: m.doc,
      })),
    [modules],
  );

  if (status === "error")
    return <p className={styles.note}>Catalogue unavailable: {error}</p>;
  if (status !== "ready")
    return <p className={styles.note}>Loading the catalogue…</p>;

  return (
    <SearchableTreeNavigator
      items={items}
      placeholder="Search modules"
      ariaLabel="Search modules"
      emptyMessage="No matching module"
      onChoose={(item) => {
        const descriptor = useCatalogStore.getState().get(item.id);
        if (descriptor === undefined) return;
        const sizeOf = (type: string) => {
          const found = useCatalogStore.getState().get(type);
          // A type the catalogue does not know still needs a size, or every unknown module would be
          // placed at the origin on top of the others.
          if (found === undefined) return { width: 144, height: 96 };
          const layout = measureNode(found);
          return { width: layout.width, height: layout.height };
        };
        const doc = usePatchStore.getState().doc;
        usePatchStore
          .getState()
          .apply([addModuleOp(doc, descriptor, sizeOf, { x: 48, y: 48 })], {
            label: `Add ${descriptor.name}`,
          });
      }}
    />
  );
};

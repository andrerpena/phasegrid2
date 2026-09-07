import { useCatalogStore } from "@renderer/catalog/catalog-store";
import { measureNode } from "@renderer/grid/layout";
import { addModuleOp } from "@renderer/patch/add-module";
import { usePatchStore } from "@renderer/patch/patch-store";
import type { ModuleDescriptor } from "@shared/protocol/catalog";
import { useMemo, useState } from "react";
import styles from "./CatalogPanel.module.css";

/**
 * Every module the engine has, grouped by category, with a search box.
 *
 * The list comes entirely from the engine's descriptors, so a module added to the engine appears here
 * with its name, its category and its documentation and nothing needs changing in the interface.
 */
export const CatalogPanel = () => {
  const modules = useCatalogStore((s) => s.modules);
  const status = useCatalogStore((s) => s.status);
  const error = useCatalogStore((s) => s.error);
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (m: ModuleDescriptor) =>
      q === "" ||
      m.name.toLowerCase().includes(q) ||
      m.id.toLowerCase().includes(q) ||
      m.category.toLowerCase().includes(q);
    const byCategory = new Map<string, ModuleDescriptor[]>();
    for (const module of modules) {
      if (!matches(module)) continue;
      const bucket = byCategory.get(module.category) ?? [];
      bucket.push(module);
      byCategory.set(module.category, bucket);
    }
    return [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [modules, query]);

  const add = (descriptor: ModuleDescriptor) => {
    const doc = usePatchStore.getState().doc;
    const sizeOf = (type: string) => {
      const found = useCatalogStore.getState().get(type);
      // A type the catalogue does not know still needs a size, or placement would put every unknown
      // module at the origin on top of each other.
      return found === undefined
        ? { width: 144, height: 96 }
        : {
            width: measureNode(found).width,
            height: measureNode(found).height,
          };
    };
    // Placed near the top left of the patch rather than at the pointer: the panel is not the canvas,
    // and a module that appears somewhere off screen looks like nothing happened.
    usePatchStore
      .getState()
      .apply([addModuleOp(doc, descriptor, sizeOf, { x: 48, y: 48 })], {
        label: `Add ${descriptor.name}`,
      });
  };

  if (status === "error")
    return <p className={styles.note}>Catalogue unavailable: {error}</p>;
  if (status !== "ready")
    return <p className={styles.note}>Loading the catalogue…</p>;

  return (
    <div className={styles.root}>
      <input
        className={styles.search}
        value={query}
        placeholder="Search modules"
        aria-label="Search modules"
        onChange={(event) => setQuery(event.target.value)}
      />
      {groups.length === 0 && (
        <p className={styles.note}>Nothing matches “{query}”.</p>
      )}
      {groups.map(([category, items]) => (
        <section key={category} className={styles.group}>
          <h3 className={styles.category}>{category}</h3>
          <ul className={styles.list}>
            {items.map((module) => (
              <li key={module.id}>
                <button
                  type="button"
                  className={styles.item}
                  title={module.doc}
                  onClick={() => add(module)}
                >
                  <span className={styles.name}>{module.name}</span>
                  <span className={styles.id}>{module.id}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
};

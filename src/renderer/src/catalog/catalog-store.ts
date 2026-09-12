import { useEngineStore } from "@renderer/engine/engine-store";
import { CatalogSchema, type ModuleDescriptor } from "@shared/protocol/catalog";
import { create } from "zustand";

/**
 * What modules exist, as the engine describes them.
 *
 * The interface draws nodes from these descriptors rather than from a table of its own, which is what
 * makes adding a module to the engine enough: one C++ file and a line of registration, and the node
 * appears with its ports, their colours and its parameters, with no change here at all.
 */

export interface CatalogState {
  modules: ModuleDescriptor[];
  byId: Map<string, ModuleDescriptor>;
  byCategory: Map<string, ModuleDescriptor[]>;
  hash: string | null;
  status: "empty" | "loading" | "ready" | "error";
  error: string | null;
}

export interface CatalogActions {
  load: () => Promise<void>;
  get: (typeId: string) => ModuleDescriptor | undefined;
}

function index(modules: ModuleDescriptor[]) {
  const byId = new Map<string, ModuleDescriptor>();
  const byCategory = new Map<string, ModuleDescriptor[]>();
  for (const module of modules) {
    byId.set(module.id, module);
    const bucket = byCategory.get(module.category) ?? [];
    bucket.push(module);
    byCategory.set(module.category, bucket);
  }
  return { byId, byCategory };
}

export const useCatalogStore = create<CatalogState & CatalogActions>(
  (set, get) => ({
    modules: [],
    byId: new Map(),
    byCategory: new Map(),
    hash: null,
    status: "empty",
    error: null,

    load: async () => {
      set({ status: "loading", error: null });
      try {
        const raw = await useEngineStore.getState().call("catalog.get", {});
        // Validated rather than trusted, even though it came from our own engine: a version mismatch
        // between the two halves is exactly the situation where the shapes disagree, and failing here
        // with a clear message beats drawing a node with undefined ports.
        const catalog = CatalogSchema.parse(raw);
        set({
          modules: catalog.modules,
          ...index(catalog.modules),
          hash: catalog.catalogHash,
          status: "ready",
        });
      } catch (error) {
        set({ status: "error", error: (error as Error).message });
      }
    },

    get: (typeId) => get().byId.get(typeId),
  }),
);

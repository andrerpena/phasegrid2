import { useCatalogStore } from "@renderer/catalog/catalog-store";
import { usePatchStore } from "@renderer/patch/patch-store";
import { openPatternEditor } from "./pattern-editor";

/**
 * Opens the editor for one of a module's text properties, wherever the ask came from.
 *
 * The inspector's expand button, a double-click on the module's face and the `patch.editText`
 * command all land here, so the three cannot drift into three slightly different editors. The write
 * goes through the same `moduleSetData` op the inspector uses, with the whole previous blob as its
 * inverse, which is what makes an edit undo like any other.
 */
export function editModuleText(moduleId: string, textId: string): void {
  const module = usePatchStore
    .getState()
    .doc.modules.find((m) => m.id === moduleId);
  if (module === undefined) return;
  const descriptor = useCatalogStore.getState().byId.get(module.type);
  const text = descriptor?.texts.find((t) => t.id === textId);
  if (text === undefined) return;
  const held = module.data?.[textId];

  openPatternEditor({
    moduleId,
    text,
    value: typeof held === "string" ? held : text.default,
    onCommit: (value) => {
      const current = usePatchStore
        .getState()
        .doc.modules.find((m) => m.id === moduleId);
      if (current === undefined) return;
      const before = current.data ?? {};
      if (before[textId] === value) return;
      usePatchStore.getState().apply(
        [
          {
            op: "moduleSetData",
            id: moduleId,
            data: { ...before, [textId]: value },
          },
        ],
        {
          label: `Edit ${text.name}`,
          inverse: [{ op: "moduleSetData", id: moduleId, data: before }],
        },
      );
    },
  });
}

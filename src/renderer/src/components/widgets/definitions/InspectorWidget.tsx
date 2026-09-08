import { useCatalogStore } from "@renderer/catalog/catalog-store";
import { SchemaFormBody } from "@renderer/components/form";
import { useSchemaForm } from "@renderer/components/form/useSchemaForm";
import {
  buildModuleSchema,
  flattenModule,
  numericValue,
  paramIdFor,
} from "@renderer/patch/module-schema";
import { usePatchStore } from "@renderer/patch/patch-store";
import { useSelectionStore } from "@renderer/selection/selection-store";
import { SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import type { WidgetDefinition } from "../types";

/**
 * The selected module's parameters, as a form.
 *
 * Every field comes from the engine's descriptor — its label, its range, its unit, whether it is a
 * dropdown — so a module added to the engine gets a working inspector with no change here. See
 * `patch/module-schema.ts`.
 *
 * Edits go through `patchStore.apply` with a `paramSet` op, which is the same path a knob drag on the
 * canvas takes. That is what makes an edit here undoable, reach the engine, and turn the knob on the
 * canvas, without any of that being wired up twice.
 */

const Empty = ({ children }: { children: string }) => (
  <p className="m-0 p-3 text-xs italic text-muted-foreground">{children}</p>
);

const ModuleInspector = ({ moduleId }: { moduleId: string }) => {
  const module = usePatchStore((s) =>
    s.doc.modules.find((m) => m.id === moduleId),
  );
  const descriptor = useCatalogStore((s) => s.byId.get(module?.type ?? ""));

  // The shape depends only on the module type, so it is rebuilt when the type changes and not when
  // a value does -- which during a knob drag is every frame.
  const schema = useMemo(
    () => (descriptor === undefined ? null : buildModuleSchema(descriptor)),
    [descriptor],
  );
  const values = useMemo(
    () =>
      module === undefined || descriptor === undefined
        ? null
        : flattenModule(module, descriptor),
    [module, descriptor],
  );

  // Declared unconditionally: hooks cannot be skipped, and the empty cases are handled after.
  const form = useSchemaForm({
    schema: schema ?? (null as never),
    onSubmit: () => {},
    initialValues: (values ?? {}) as Record<string, unknown>,
  });

  /**
   * Pushes what the form holds back into the document.
   *
   * Compared against the document rather than against the last thing pushed, so a value the canvas
   * changed -- a knob drag, an undo -- does not look like an edit to send back. Without that the
   * form and the document fight each other for a moving parameter.
   */
  const pushed = useRef<Record<string, unknown>>({});
  useEffect(() => {
    if (module === undefined || descriptor === undefined) return;
    const state = form.formState as Record<string, unknown>;
    for (const [key, value] of Object.entries(state)) {
      const paramId = paramIdFor(key);
      if (paramId === null) continue;
      const param = descriptor.params.find((p) => p.id === paramId);
      if (param === undefined || param.flags.structural) continue;
      if (pushed.current[key] === value) continue;

      const next = numericValue(param, value);
      const current = module.params?.[paramId] ?? param.default;
      pushed.current[key] = value;
      if (next === current) continue;

      usePatchStore
        .getState()
        .apply(
          [{ op: "paramSet", module: module.id, param: paramId, value: next }],
          {
            label: `Set ${param.name}`,
            inverse: [
              {
                op: "paramSet",
                module: module.id,
                param: paramId,
                value: current,
              },
            ],
          },
        );
    }
  }, [form.formState, module, descriptor]);

  if (module === undefined)
    return <Empty>That module is no longer in the patch.</Empty>;
  if (descriptor === undefined || schema === null)
    return <Empty>The engine has no description of this module.</Empty>;

  return (
    <div className="p-2">
      <SchemaFormBody form={form} mode="edit" autoFocusFirst={false} />
    </div>
  );
};

const InspectorWidgetComponent = () => {
  const ids = useSelectionStore((s) => s.modules);

  if (ids.length === 0)
    return <Empty>Select a module to edit its parameters.</Empty>;
  if (ids.length > 1)
    return (
      <Empty>{`${ids.length} modules selected. Select one to edit its parameters.`}</Empty>
    );

  // Keyed by module, so the form's own state is rebuilt when the selection moves rather than the
  // previous module's values being shown against the new one's fields.
  return <ModuleInspector key={ids[0]} moduleId={ids[0]} />;
};

export const inspectorWidget: WidgetDefinition = {
  id: "inspector",
  label: "Inspector",
  icon: SlidersHorizontal,
  component: InspectorWidgetComponent,
  placement: { unique: true },
  // Under the canvas rather than beside it: the form is label-and-value rows, and a sidebar wide
  // enough for the values is a sidebar that has taken the room the grid wanted.
  defaultSlot: "center-bottom",
  scope: "inspector",
};

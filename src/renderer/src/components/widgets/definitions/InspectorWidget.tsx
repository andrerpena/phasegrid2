import { useSelectionStore } from "@renderer/selection/selection-store";
import { SlidersHorizontal } from "lucide-react";
import type { WidgetDefinition } from "../types";

const InspectorWidgetComponent = () => {
  const ids = useSelectionStore((s) => s.modules);

  if (ids.length === 0)
    return (
      <p className="m-0 p-3 text-xs italic text-muted-foreground">
        Select a module to edit its parameters.
      </p>
    );
  if (ids.length > 1)
    return (
      <p className="m-0 p-3 text-xs italic text-muted-foreground">
        {ids.length} modules selected. Select one to edit its parameters.
      </p>
    );

  return (
    <p className="m-0 p-3 text-xs italic text-muted-foreground">{ids[0]}</p>
  );
};

export const inspectorWidget: WidgetDefinition = {
  id: "inspector",
  label: "Inspector",
  icon: SlidersHorizontal,
  component: InspectorWidgetComponent,
  placement: { unique: true },
  defaultSlot: "right-top",
  scope: "inspector",
};

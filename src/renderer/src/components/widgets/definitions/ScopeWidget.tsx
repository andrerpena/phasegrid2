import { Activity } from "lucide-react";
import type { WidgetDefinition } from "../types";

const ScopeWidgetComponent = () => (
  <p className="m-0 p-3 text-xs text-muted-foreground">
    Meters and scopes read shared memory directly.
  </p>
);

export const scopeWidget: WidgetDefinition = {
  id: "scope",
  label: "Scope",
  icon: Activity,
  component: ScopeWidgetComponent,
  defaultSlot: "right-bottom",
  scrollable: false,
  scope: "scope",
};

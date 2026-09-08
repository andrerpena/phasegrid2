import { ScrollText } from "lucide-react";
import type { WidgetDefinition } from "../types";

const LogWidgetComponent = () => (
  <p className="m-0 p-3 text-xs text-muted-foreground">Engine log.</p>
);

export const logWidget: WidgetDefinition = {
  id: "log",
  label: "Log",
  icon: ScrollText,
  component: LogWidgetComponent,
  defaultSlot: "center-bottom",
  scope: "log",
};

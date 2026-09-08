import { CatalogPanel } from "@renderer/widgets/CatalogPanel";
import { Boxes } from "lucide-react";
import type { WidgetDefinition } from "../types";

export const catalogWidget: WidgetDefinition = {
  id: "catalog",
  label: "Catalog",
  icon: Boxes,
  component: CatalogPanel,
  defaultSlot: "left-top",
  scrollable: false,
  scope: "catalog",
};

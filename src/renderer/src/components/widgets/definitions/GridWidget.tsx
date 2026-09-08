import { ProjectTabs } from "@renderer/project/ProjectTabs";
import { Grid3x3 } from "lucide-react";
import type { WidgetDefinition } from "../types";

/**
 * The grid, and the projects open in it.
 *
 * Two levels of tab, on purpose. The outer one is the dock's — it puts the grid beside the settings
 * editor and nothing else. The inner one is the document's, one tab per open project. They are
 * different questions ("what am I looking at" and "which piece am I working on") and collapsing them
 * into one strip would mean closing a project and closing a panel were the same gesture.
 */
export const gridWidget: WidgetDefinition = {
  id: "grid",
  label: "Grid",
  icon: Grid3x3,
  component: ProjectTabs,
  placement: { pinned: true, allowedSlots: ["center"], unique: true },
  defaultSlot: "center",
  size: "wide",
  scrollable: false,
};

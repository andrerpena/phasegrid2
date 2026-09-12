import { ProjectsPanel } from "@renderer/workspace/ProjectsPanel";
import { FolderOpen } from "lucide-react";
import type { WidgetDefinition } from "../types";

export const projectsWidget: WidgetDefinition = {
  id: "projects",
  label: "Projects",
  icon: FolderOpen,
  component: ProjectsPanel,
  defaultSlot: "left-bottom",
  scope: "projects",
};

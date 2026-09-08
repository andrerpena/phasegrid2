import { GridView } from "@renderer/grid/GridView";
import { ProjectHeader } from "./ProjectHeader";

/**
 * One project: its header, and its grid.
 *
 * Every project has a grid; the header carries what the grid cannot, which is everything about the
 * piece rather than the wiring.
 */
export const ProjectView = () => (
  <div className="flex h-full min-h-0 flex-col">
    <ProjectHeader />
    <div className="relative min-h-0 flex-1">
      <GridView />
    </div>
  </div>
);

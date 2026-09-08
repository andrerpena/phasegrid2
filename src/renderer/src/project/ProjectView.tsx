import { ControlBarSlot } from "@renderer/components/control-bars";
import { GridView } from "@renderer/grid/GridView";
import { ProjectHeader } from "./ProjectHeader";

/**
 * One project: its header, its grid, and the controls that float over it.
 *
 * Every project has a grid; the header carries what the grid cannot, which is everything about the
 * piece rather than the wiring. The control bars sit inside the canvas's box rather than in the
 * header because they are about the view — where you are looking and how closely — and belong where
 * you are looking.
 */
export const ProjectView = () => (
  <div className="flex h-full min-h-0 flex-col">
    <ProjectHeader />
    <div className="relative min-h-0 flex-1">
      <GridView />
      <ControlBarSlot position="left-top" />
      <ControlBarSlot position="right-top" />
      <ControlBarSlot position="left-bottom" />
      <ControlBarSlot position="right-bottom" />
    </div>
  </div>
);

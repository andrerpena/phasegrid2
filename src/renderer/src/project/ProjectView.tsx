import { ControlBarSlot } from "@renderer/components/control-bars";
import { GridView } from "@renderer/grid/GridView";
import { useProjectStore } from "@renderer/project/project-store";
import { cn } from "@renderer/utils/cn";
import { ProjectHeader } from "./ProjectHeader";
import { SourceView } from "./SourceView";

/**
 * One project: its header, its grid, and the controls that float over it.
 *
 * Every project has a grid; the header carries what the grid cannot, which is everything about the
 * piece rather than the wiring. The control bars sit inside the canvas's box rather than in the
 * header because they are about the view — where you are looking and how closely — and belong where
 * you are looking.
 */
export const ProjectView = () => {
  const activeId = useProjectStore((s) => s.activeId);
  const source = useProjectStore(
    (s) => s.activeId !== null && s.sourceIds.includes(s.activeId),
  );
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ProjectHeader />
      <div className="relative min-h-0 flex-1">
        {/*
          The grid stays mounted under the source view rather than being replaced by it. It owns a
          canvas with a graphics context and an engine subscription, and a toggle should not throw both
          away and rebuild them; `invisible` keeps its size, so nothing is re-laid-out on the way back.
        */}
        <div className={cn("absolute inset-0", source && "invisible")}>
          <GridView />
          <ControlBarSlot position="left-top" />
          <ControlBarSlot position="right-top" />
          <ControlBarSlot position="left-bottom" />
          <ControlBarSlot position="right-bottom" />
        </div>
        {source && activeId !== null && (
          <div className="absolute inset-0">
            <SourceView id={activeId} />
          </div>
        )}
      </div>
    </div>
  );
};

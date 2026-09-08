import { useProjectStore } from "@renderer/project/project-store";
import { cn } from "@renderer/utils/cn";
import { useWorkspaceStore } from "./workspace-store";

/**
 * What is in the workspace.
 *
 * The list a person browses, as against the palette, which is the list a person searches. Both exist
 * because they answer different questions: "what have I got" and "open the one I am thinking of".
 *
 * Projects are ordered by when they were last written, so the one you were working on yesterday is at
 * the top rather than wherever the alphabet put it.
 */
export const ProjectsPanel = () => {
  const projects = useWorkspaceStore((s) => s.projects);
  const openProject = useWorkspaceStore((s) => s.openProject);
  const removeProject = useWorkspaceStore((s) => s.removeProject);
  const open = useProjectStore((s) => s.projects);
  const activeId = useProjectStore((s) => s.activeId);
  const activate = useProjectStore((s) => s.activate);
  const dirtyIds = useProjectStore((s) => s.dirtyIds);

  if (projects.length === 0)
    return (
      <p className="m-0 p-3 text-xs text-muted-foreground">
        Nothing saved here yet. Make something and press ⌘S.
      </p>
    );

  return (
    <ul className="m-0 flex list-none flex-col gap-px overflow-y-auto p-1">
      {projects.map((summary) => {
        const tab = open.find((p) => p.slug === summary.slug);
        return (
          <li key={summary.slug} className="group flex items-center">
            <button
              type="button"
              className={cn(
                "flex min-w-0 flex-1 cursor-pointer items-center gap-1 overflow-hidden text-ellipsis whitespace-nowrap rounded-sm px-2 py-1 text-left text-xs hover:bg-card",
                tab === undefined ? "text-muted-foreground" : "text-foreground",
                tab !== undefined && tab.id === activeId && "bg-card",
              )}
              title={summary.slug}
              // Already open means bring it forward. Reading it again would replace what is on screen
              // with what is on disk, which for an unsaved tab is a way to lose an afternoon.
              onClick={() =>
                tab === undefined
                  ? void openProject(summary.slug)
                  : activate(tab.id)
              }
            >
              {summary.name}
              {tab !== undefined && dirtyIds.includes(tab.id) && (
                <span className="text-signal-note" title="Unsaved changes">
                  •
                </span>
              )}
            </button>
            <button
              type="button"
              // Hidden until the row is under the pointer: a delete button beside every name is a
              // delete button that eventually gets pressed by accident.
              className="cursor-pointer px-1 text-transparent group-hover:text-muted-foreground focus-visible:text-muted-foreground hover:!text-destructive"
              aria-label={`Delete ${summary.name}`}
              title={`Delete ${summary.name}`}
              onClick={() => void removeProject(summary.slug)}
            >
              ×
            </button>
          </li>
        );
      })}
    </ul>
  );
};

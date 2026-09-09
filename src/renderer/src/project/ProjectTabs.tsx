import { emptyProject, useProjectStore } from "@renderer/project/project-store";
import { cn } from "@renderer/utils/cn";
import { closeProject } from "@renderer/workspace/unsaved";
import { ProjectView } from "./ProjectView";

/**
 * The main slot: several projects open at once, one in front.
 *
 * Only one can be heard, because there is one engine, so the tab in front is the one the engine is
 * running. Switching swaps the whole document across.
 */
export const ProjectTabs = () => {
  const projects = useProjectStore((s) => s.projects);
  const activeId = useProjectStore((s) => s.activeId);
  const activate = useProjectStore((s) => s.activate);
  const open = useProjectStore((s) => s.open);
  const dirtyIds = useProjectStore((s) => s.dirtyIds);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="flex flex-none items-stretch gap-px overflow-x-auto border-b border-border bg-background"
        role="tablist"
      >
        {projects.map((project) => (
          <div
            key={project.id}
            className={cn(
              "flex items-center border-b-2 border-transparent",
              project.id === activeId && "border-b-ring bg-card",
            )}
          >
            <button
              type="button"
              role="tab"
              aria-selected={project.id === activeId}
              className={cn(
                "flex cursor-pointer items-center gap-1 whitespace-nowrap py-1 pl-2 pr-1 text-xs",
                project.id === activeId
                  ? "text-foreground"
                  : "text-muted-foreground",
              )}
              onClick={() => activate(project.id)}
              title={project.description ?? project.name}
            >
              {project.name}
              {/* A dot rather than an asterisk in the name: it does not shift the label as you type,
                  and it is the mark every other document application uses for the same thing. */}
              {dirtyIds.includes(project.id) && (
                <span
                  className="leading-none text-signal-note"
                  title="Unsaved changes"
                >
                  •
                </span>
              )}
              {project.kind === "example" && (
                <span className="rounded-sm border border-border px-1 text-2xs uppercase tracking-wide text-signal-note">
                  example
                </span>
              )}
            </button>
            <button
              type="button"
              className="cursor-pointer px-1 text-muted-foreground hover:text-foreground"
              aria-label={`Close ${project.name}`}
              onClick={() => void closeProject(project.id)}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className="cursor-pointer px-1 text-muted-foreground hover:text-foreground"
          aria-label="New project"
          onClick={() => open(emptyProject())}
        >
          +
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        {activeId === null ? (
          <p className="m-0 p-4 text-xs text-muted-foreground">
            No project open. Press{" "}
            <kbd className="rounded-sm border border-border px-1 text-2xs">
              ⌘K
            </kbd>{" "}
            and search for a module to open its example, or pick one from
            Projects on the left.
          </p>
        ) : (
          // Keyed by project, so switching tabs rebuilds the canvas rather than reusing one built for
          // a different document. The alternative is a canvas that quietly keeps the previous
          // project's interaction rules.
          <ProjectView key={activeId} />
        )}
      </div>
    </div>
  );
};

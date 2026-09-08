import { emptyProject, useProjectStore } from "@renderer/project/project-store";
import { closeProject } from "@renderer/workspace/unsaved";
import styles from "./ProjectTabs.module.css";
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
    <div className={styles.root}>
      <div className={styles.strip} role="tablist">
        {projects.map((project) => (
          <div
            key={project.id}
            className={styles.tab}
            data-active={project.id === activeId}
          >
            <button
              type="button"
              role="tab"
              aria-selected={project.id === activeId}
              className={styles.label}
              onClick={() => activate(project.id)}
              title={project.description ?? project.name}
            >
              {project.name}
              {/* A dot rather than an asterisk in the name: it does not shift the label as you type,
                  and it is the mark every other document application uses for the same thing. */}
              {dirtyIds.includes(project.id) && (
                <span className={styles.dirty} title="Unsaved changes">
                  •
                </span>
              )}
              {project.kind === "example" && (
                <span className={styles.badge}>example</span>
              )}
            </button>
            <button
              type="button"
              className={styles.close}
              aria-label={`Close ${project.name}`}
              onClick={() => void closeProject(project.id)}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className={styles.add}
          aria-label="New project"
          onClick={() => open(emptyProject())}
        >
          +
        </button>
      </div>
      <div className={styles.body}>
        {activeId === null ? (
          <p className={styles.empty}>
            No project open. Press <kbd>⌘K</kbd> and search for a module to open
            its example, or pick one from Projects on the left.
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

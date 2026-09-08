import { useProjectStore } from "@renderer/project/project-store";
import styles from "./ProjectsPanel.module.css";
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
      <p className={styles.empty}>
        Nothing saved here yet. Make something and press ⌘S.
      </p>
    );

  return (
    <ul className={styles.list}>
      {projects.map((summary) => {
        const tab = open.find((p) => p.slug === summary.slug);
        return (
          <li key={summary.slug} className={styles.row}>
            <button
              type="button"
              className={styles.name}
              data-open={tab !== undefined}
              data-active={tab !== undefined && tab.id === activeId}
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
                <span className={styles.dirty} title="Unsaved changes">
                  •
                </span>
              )}
            </button>
            <button
              type="button"
              className={styles.delete}
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

import { Button } from "@renderer/components/buttons/Button";
import styles from "./WorkspaceGate.module.css";
import { useWorkspaceStore } from "./workspace-store";

/**
 * What you see before there is a workspace.
 *
 * Deliberately a gate rather than an empty shell. Everything in the application writes to a workspace or
 * reads from one, so a shell with no workspace behind it would offer a canvas you can build on and
 * cannot keep — and the moment to find that out is not after an hour's work.
 *
 * The engine connects behind this, so the catalogue is already loaded by the time a folder is picked.
 */
export const WorkspaceGate = () => {
  const status = useWorkspaceStore((s) => s.status);
  const recent = useWorkspaceStore((s) => s.recent);
  const error = useWorkspaceStore((s) => s.error);
  const choose = useWorkspaceStore((s) => s.choose);
  const openAt = useWorkspaceStore((s) => s.openAt);

  return (
    <div className={styles.root} data-kb-scope="workspace-gate">
      <div className={styles.panel}>
        <h1 className={styles.title}>phasegrid</h1>
        <p className={styles.blurb}>
          A workspace is one folder holding your projects, your settings and the
          modules you build. Pick a folder to use as one — an empty one becomes
          a workspace, and one you have used before opens as it was.
        </p>

        <Button variant="primary" onClick={() => void choose()}>
          Open Workspace…
        </Button>

        {recent.length > 0 && (
          <>
            <h2 className={styles.heading}>Recent</h2>
            <ul className={styles.recent}>
              {recent.map((path) => (
                <li key={path}>
                  <button
                    type="button"
                    className={styles.recentItem}
                    onClick={() => void openAt(path)}
                    title={path}
                  >
                    {/* The folder's own name reads first, because that is what a person calls it; the
                        path underneath is what tells two folders of the same name apart. */}
                    <span className={styles.recentName}>
                      {path.split("/").at(-1)}
                    </span>
                    <span className={styles.recentPath}>{path}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        {error !== null && <p className={styles.error}>{error}</p>}
        {status === "booting" && <p className={styles.blurb}>Looking…</p>}
      </div>
    </div>
  );
};

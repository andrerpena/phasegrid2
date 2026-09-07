import { GridView } from "@renderer/grid/GridView";
import { ProjectHeader } from "./ProjectHeader";
import styles from "./ProjectView.module.css";

/**
 * One project: its header, and its grid.
 *
 * Every project has a grid; the header carries what the grid cannot, which is everything about the
 * piece rather than the wiring.
 */
export const ProjectView = () => (
  <div className={styles.root}>
    <ProjectHeader />
    <div className={styles.grid}>
      <GridView />
    </div>
  </div>
);

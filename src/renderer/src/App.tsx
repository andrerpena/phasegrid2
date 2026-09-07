import styles from "./App.module.css";

export const App = () => (
  <div className={styles.root}>
    <h1 className={styles.title}>phasegrid2</h1>
    <p className={styles.status}>v{__APP_VERSION__} · engine: not connected</p>
  </div>
);

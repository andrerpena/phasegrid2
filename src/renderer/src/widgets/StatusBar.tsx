import { commandRegistry } from "@renderer/commands/registry";
import { useEngineStore } from "@renderer/engine/engine-store";
import { useThemeStore } from "@renderer/theming/theme-store";
import { THEMES } from "@renderer/theming/themes";
import { useWorkspaceStore } from "@renderer/workspace/workspace-store";
import styles from "./StatusBar.module.css";

/** The bottom strip: which workspace you are in, whether the engine is alive, and what theme is on. */
export const StatusBar = () => {
  const status = useEngineStore((s) => s.status);
  const detail = useEngineStore((s) => s.detail);
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const workspace = useWorkspaceStore((s) => s.name);
  const root = useWorkspaceStore((s) => s.root);

  return (
    <div className={styles.root}>
      {/* Where your work is going, first: it is the one fact on this strip that changes what saving
          means, and it is otherwise invisible. */}
      <button
        type="button"
        className={styles.workspace}
        title={root ?? "No workspace"}
        onClick={() => void commandRegistry.dispatch("workspace.open")}
      >
        {workspace === "" ? "No workspace" : workspace}
      </button>
      <span className={styles.indicator} data-status={status} />
      <span className={styles.status}>{detail}</span>
      <span className={styles.spacer} />
      <label className={styles.themePicker}>
        Theme
        <select
          value={theme.id}
          onChange={(event) => setTheme(event.target.value)}
          className={styles.select}
        >
          {THEMES.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <span className={styles.version}>v{__APP_VERSION__}</span>
    </div>
  );
};

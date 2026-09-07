import { useEngineStore } from "@renderer/engine/engine-store";
import { useThemeStore } from "@renderer/theming/theme-store";
import { THEMES } from "@renderer/theming/themes";
import styles from "./StatusBar.module.css";

/** The bottom strip: whether the engine is alive, and what theme is on. */
export const StatusBar = () => {
  const status = useEngineStore((s) => s.status);
  const detail = useEngineStore((s) => s.detail);
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  return (
    <div className={styles.root}>
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

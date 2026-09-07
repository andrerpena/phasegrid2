import { useThemeStore } from "@renderer/theming/theme-store";
import { THEMES } from "@renderer/theming/themes";
import { useEffect, useState } from "react";
import styles from "./App.module.css";

/**
 * The shell, for now: enough to prove the theme reaches CSS and the engine reaches the renderer.
 *
 * The dock, widgets and grid replace this in the phases that follow. What is worth keeping from it is
 * the engine status line, because a window that cannot say whether the engine is running is a window
 * that will one day be silent for a reason nobody can see.
 */
export const App = () => {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const [status, setStatus] = useState("connecting");

  useEffect(() => {
    let cancelled = false;
    window.engine
      .call("hello", { protocolVersion: 1, client: "phasegrid2" })
      .then((hello) => {
        if (!cancelled) setStatus(`engine ${hello.engineVersion}`);
      })
      .catch((error: Error) => {
        if (!cancelled) setStatus(error.message);
      });
    // Every engine event, including the one that says it restarted after a crash.
    const stop = window.engine.onEvent((event) => {
      if (event.event === "engine.ready") setStatus("engine ready");
      if (event.event === "engine.error")
        setStatus(`engine error: ${JSON.stringify(event.data)}`);
    });
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  return (
    <div className={styles.root}>
      <h1 className={styles.title}>phasegrid2</h1>
      <p className={styles.status}>
        v{__APP_VERSION__} · {status}
      </p>
      <div className={styles.themes}>
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            className={styles.themeButton}
            aria-pressed={t.id === theme.id}
            onClick={() => setTheme(t.id)}
          >
            {t.name}
          </button>
        ))}
      </div>
      <ul className={styles.legend}>
        {Object.keys(theme.grid.signal).map((role) => (
          <li key={role} className={styles.legendItem}>
            <span
              className={styles.swatch}
              style={{ background: `var(--color-signal-${role})` }}
            />
            {role}
          </li>
        ))}
      </ul>
    </div>
  );
};

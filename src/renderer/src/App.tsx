import { Dock } from "@renderer/components/dock/Dock";
import { Panel } from "@renderer/components/panel/Panel";
import { Tabs } from "@renderer/components/tabs/Tabs";
import { useConfigStore } from "@renderer/config/config-store";
import { useEngineStore, watchEngine } from "@renderer/engine/engine-store";
import { useLayoutStore } from "@renderer/layout/layout-store";
import { useThemeStore } from "@renderer/theming/theme-store";
import { StatusBar } from "@renderer/widgets/StatusBar";
import { useEffect, useState } from "react";
import styles from "./App.module.css";

/**
 * The shell.
 *
 * The panels are placeholders for now; what is real is the arrangement, the theme reaching both CSS and
 * the canvas, and the engine connection. The grid, the inspector and the catalogue replace these
 * contents in the phases that follow, without moving anything around them.
 */
export const App = () => {
  const connect = useEngineStore((s) => s.connect);
  const loadConfig = useConfigStore((s) => s.load);
  const loadLayout = useLayoutStore((s) => s.load);
  const theme = useThemeStore((s) => s.theme);
  const [rightTab, setRightTab] = useState("inspector");

  useEffect(() => {
    void loadConfig();
    void loadLayout();
    void connect();
    return watchEngine();
  }, [connect, loadConfig, loadLayout]);

  return (
    <Dock
      top={<div className={styles.transport}>transport</div>}
      leftTop={
        <Panel title="Catalog" scope="catalog">
          <p className={styles.placeholder}>
            Module catalogue arrives with the grid editor.
          </p>
        </Panel>
      }
      leftBottom={
        <Panel title="History" scope="history">
          <p className={styles.placeholder}>Undo history.</p>
        </Panel>
      }
      center={
        <div className={styles.grid} data-kb-scope="grid">
          <p className={styles.placeholder}>The grid renders here.</p>
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
      }
      centerBottom={
        <Panel title="Log" scope="logs">
          <p className={styles.placeholder}>Engine log.</p>
        </Panel>
      }
      rightTop={
        <Tabs
          activeId={rightTab}
          onSelect={setRightTab}
          tabs={[
            {
              id: "inspector",
              label: "Inspector",
              content: (
                <p className={styles.placeholder}>
                  Select a module to edit its parameters.
                </p>
              ),
            },
            {
              id: "settings",
              label: "Settings",
              content: (
                <p className={styles.placeholder}>Configuration editor.</p>
              ),
            },
          ]}
        />
      }
      rightBottom={
        <Panel title="Scope" scope="scope">
          <p className={styles.placeholder}>
            Meters and scopes read shared memory directly.
          </p>
        </Panel>
      }
      bottom={<StatusBar />}
    />
  );
};

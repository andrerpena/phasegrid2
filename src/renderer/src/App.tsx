import { useCatalogStore } from "@renderer/catalog/catalog-store";
import { registerShellCommands } from "@renderer/commands/definitions";
import { CommandPalette } from "@renderer/components/command-palette/CommandPalette";
import { Dock } from "@renderer/components/dock/Dock";
import { useModalStore } from "@renderer/components/floating/modal/modal-store";
import { Panel } from "@renderer/components/panel/Panel";
import { Tabs } from "@renderer/components/tabs/Tabs";
import { useConfigStore } from "@renderer/config/config-store";
import { useEngineStore, watchEngine } from "@renderer/engine/engine-store";
import { GridView } from "@renderer/grid/GridView";
import { useKeybindings } from "@renderer/keybindings/use-keybindings";
import { useLayoutStore } from "@renderer/layout/layout-store";
import { startEngineSync } from "@renderer/patch/engine-sync";
import { CatalogPanel } from "@renderer/widgets/CatalogPanel";
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
  const loadCatalog = useCatalogStore((s) => s.load);
  const loadConfig = useConfigStore((s) => s.load);
  const loadLayout = useLayoutStore((s) => s.load);
  const [rightTab, setRightTab] = useState("inspector");
  const paletteOpen = useModalStore((s) => s.isOpen("command-palette"));
  const hideModal = useModalStore((s) => s.hide);
  useKeybindings();

  useEffect(() => {
    registerShellCommands();
    void loadConfig();
    void loadLayout();
    // The catalogue is fetched every time the engine becomes ready, not once after the first attempt.
    // The first handshake can happen before the engine has finished starting, and a restarted engine is
    // a different process whose catalogue may differ, so a one-shot load leaves the interface either
    // empty or describing a build that is no longer running.
    const stopStatus = useEngineStore.subscribe((state, previous) => {
      if (state.status === "ready" && previous.status !== "ready")
        void loadCatalog();
    });
    void connect();
    // From here every edit reaches the engine. Started before the first edit can happen, so nothing
    // is applied to the document that the engine never hears about.
    const stopSync = startEngineSync();
    const stopWatch = watchEngine();
    return () => {
      stopStatus();
      stopSync();
      stopWatch();
    };
  }, [connect, loadCatalog, loadConfig, loadLayout]);

  return (
    <>
      <Dock
        top={<div className={styles.transport}>transport</div>}
        leftTop={
          <Panel title="Catalog" scope="catalog">
            <CatalogPanel />
          </Panel>
        }
        leftBottom={
          <Panel title="History" scope="history">
            <p className={styles.placeholder}>Undo history.</p>
          </Panel>
        }
        center={<GridView />}
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
      <CommandPalette
        open={paletteOpen}
        onClose={() => hideModal("command-palette")}
      />
    </>
  );
};

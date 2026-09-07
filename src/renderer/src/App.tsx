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
  const catalogStatus = useCatalogStore((s) => s.status);
  const catalogCount = useCatalogStore((s) => s.modules.length);
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
    // The catalogue can only be fetched once the engine answers, so it follows the handshake.
    void connect().then(() => loadCatalog());
    return watchEngine();
  }, [connect, loadCatalog, loadConfig, loadLayout]);

  return (
    <>
      <Dock
        top={<div className={styles.transport}>transport</div>}
        leftTop={
          <Panel title="Catalog" scope="catalog">
            <p className={styles.placeholder}>
              {catalogStatus === "ready"
                ? `${catalogCount} modules`
                : catalogStatus}
            </p>
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

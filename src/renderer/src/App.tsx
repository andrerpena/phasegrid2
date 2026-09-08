import { useCatalogStore } from "@renderer/catalog/catalog-store";
import { registerShellCommands } from "@renderer/commands/definitions";
import { CommandPalette } from "@renderer/components/command-palette/CommandPalette";
import { Dock } from "@renderer/components/dock/Dock";
import { useModalStore } from "@renderer/components/floating/modal/modal-store";
import { Panel } from "@renderer/components/panel/Panel";
import { Tabs } from "@renderer/components/tabs/Tabs";
import { useEngineStore, watchEngine } from "@renderer/engine/engine-store";
import { useKeybindings } from "@renderer/keybindings/use-keybindings";
import { useLayoutStore } from "@renderer/layout/layout-store";
import { startEngineSync } from "@renderer/patch/engine-sync";
import { startDirtyTracking } from "@renderer/project/dirty";
import { ProjectTabs } from "@renderer/project/ProjectTabs";
import { CatalogPanel } from "@renderer/widgets/CatalogPanel";
import { SettingsPanel } from "@renderer/widgets/SettingsPanel";
import { StatusBar } from "@renderer/widgets/StatusBar";
import { ProjectsPanel } from "@renderer/workspace/ProjectsPanel";
import { startProjectCommands } from "@renderer/workspace/project-commands";
import { SaveAsDialog } from "@renderer/workspace/SaveAsDialog";
import { startSessionPersistence } from "@renderer/workspace/session";
import { startCloseGuard } from "@renderer/workspace/unsaved";
import { WorkspaceGate } from "@renderer/workspace/WorkspaceGate";
import { useWorkspaceStore } from "@renderer/workspace/workspace-store";
import { useEffect, useState } from "react";
import styles from "./App.module.css";

/**
 * The shell.
 *
 * Nothing here appears until there is a workspace. Everything the shell can do writes to one or reads
 * from one, so a canvas with no workspace behind it would be a canvas you can build on and cannot keep —
 * and the moment to discover that is not after an hour's work.
 *
 * The engine, though, connects behind the gate: it is a separate process that knows nothing about
 * folders, and starting it early means the catalogue is loaded by the time a folder has been picked.
 */
export const App = () => {
  const connect = useEngineStore((s) => s.connect);
  const loadCatalog = useCatalogStore((s) => s.load);
  const loadLayout = useLayoutStore((s) => s.load);
  const boot = useWorkspaceStore((s) => s.boot);
  const workspaceStatus = useWorkspaceStore((s) => s.status);
  const [leftTab, setLeftTab] = useState("projects");
  const [rightTab, setRightTab] = useState("inspector");
  const paletteOpen = useModalStore((s) => s.isOpen("command-palette"));
  const hideModal = useModalStore((s) => s.hide);
  useKeybindings();

  useEffect(() => {
    registerShellCommands();
    // The layout is the installation's, so it loads once and does not wait for a workspace. The
    // settings are the workspace's and are loaded by opening one.
    void loadLayout();
    void boot();
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
    const stopDirty = startDirtyTracking();
    const stopSession = startSessionPersistence();
    const stopCommands = startProjectCommands();
    const stopClose = startCloseGuard();
    return () => {
      stopStatus();
      stopSync();
      stopWatch();
      stopDirty();
      stopSession();
      stopCommands();
      stopClose();
    };
  }, [connect, loadCatalog, loadLayout, boot]);

  if (workspaceStatus !== "ready") return <WorkspaceGate />;

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
          <Tabs
            activeId={leftTab}
            onSelect={setLeftTab}
            tabs={[
              {
                id: "projects",
                label: "Projects",
                content: <ProjectsPanel />,
              },
              {
                id: "history",
                label: "History",
                content: <p className={styles.placeholder}>Undo history.</p>,
              },
            ]}
          />
        }
        center={<ProjectTabs />}
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
                content: <SettingsPanel />,
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
      <SaveAsDialog />
    </>
  );
};

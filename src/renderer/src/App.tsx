import { useCatalogStore } from "@renderer/catalog/catalog-store";
import { registerShellCommands } from "@renderer/commands/definitions";
import { CommandPalette } from "@renderer/components/command-palette/CommandPalette";
import { registerBuiltInControlBars } from "@renderer/components/control-bars";
import { Dock } from "@renderer/components/dock/Dock";
import {
  ModalRenderer,
  useModalStore,
} from "@renderer/components/floating/modal";
import {
  registerBuiltInStatusBars,
  StatusBar,
} from "@renderer/components/status-bars";
import {
  registerBuiltInMinimapDrawers,
  registerBuiltInWidgets,
  WidgetSlot,
  watchWidgetLayout,
} from "@renderer/components/widgets";
import { useEngineStore, watchEngine } from "@renderer/engine/engine-store";
import { useKeybindings } from "@renderer/keybindings/use-keybindings";
import { useLayoutStore } from "@renderer/layout/layout-store";
import { startEngineSync } from "@renderer/patch/engine-sync";
import { startDirtyTracking } from "@renderer/project/dirty";
import { watchGridTheme } from "@renderer/theming/grid-theme-store";
import { startProjectCommands } from "@renderer/workspace/project-commands";
import { SaveAsDialog } from "@renderer/workspace/SaveAsDialog";
import { startSessionPersistence } from "@renderer/workspace/session";
import { startCloseGuard } from "@renderer/workspace/unsaved";
import { WorkspaceGate } from "@renderer/workspace/WorkspaceGate";
import { useWorkspaceStore } from "@renderer/workspace/workspace-store";
import { useEffect } from "react";

/**
 * The shell.
 *
 * Nothing here appears until there is a workspace. Everything the shell can do writes to one or reads
 * from one, so a canvas with no workspace behind it would be a canvas you can build on and cannot keep —
 * and the moment to discover that is not after an hour's work.
 *
 * The engine, though, connects behind the gate: it is a separate process that knows nothing about
 * folders, and starting it early means the catalogue is loaded by the time a folder has been picked.
 *
 * What goes in each slot is not decided here. The dock asks the widget layout, the widget layout comes
 * from the workspace's settings, and this file only says which slots exist.
 */
export const App = () => {
  const connect = useEngineStore((s) => s.connect);
  const loadCatalog = useCatalogStore((s) => s.load);
  const loadLayout = useLayoutStore((s) => s.load);
  const boot = useWorkspaceStore((s) => s.boot);
  const workspaceStatus = useWorkspaceStore((s) => s.status);
  const paletteOpen = useModalStore((s) => s.isOpen("command-palette"));
  const hideModal = useModalStore((s) => s.hide);
  useKeybindings();

  useEffect(() => {
    registerShellCommands();
    // Widgets and status bar items first: the layout is a list of names, and normalising it means
    // checking each name against a registry. Read before this, every panel in the settings file
    // would look like one this build does not have.
    registerBuiltInWidgets();
    registerBuiltInStatusBars();
    registerBuiltInControlBars();
    // What paints itself on the minimap. Separate from the widgets because a drawer is not a panel:
    // adding something drawable to the canvas registers one here and the minimap learns nothing.
    registerBuiltInMinimapDrawers();
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
    // Both follow the settings: a panel moved in `workspace.json` moves in the window, and a colour
    // typed there repaints the canvas.
    const stopLayout = watchWidgetLayout();
    const stopGridTheme = watchGridTheme();
    return () => {
      stopStatus();
      stopSync();
      stopWatch();
      stopDirty();
      stopSession();
      stopCommands();
      stopClose();
      stopLayout();
      stopGridTheme();
    };
  }, [connect, loadCatalog, loadLayout, boot]);

  if (workspaceStatus !== "ready") return <WorkspaceGate />;

  return (
    <>
      <Dock
        leftTop={<WidgetSlot slotId="left-top" />}
        leftBottom={<WidgetSlot slotId="left-bottom" />}
        // Kept mounted: the grid owns a canvas with a graphics context and an engine subscription,
        // and unmounting it to look at the settings would throw both away and rebuild them on the
        // way back — visibly, and with the viewport reset.
        center={<WidgetSlot slotId="center" variant="primary" keepMounted />}
        centerBottom={<WidgetSlot slotId="center-bottom" />}
        rightTop={<WidgetSlot slotId="right-top" />}
        rightBottom={<WidgetSlot slotId="right-bottom" />}
        bottom={<StatusBar />}
      />
      <CommandPalette
        open={paletteOpen}
        onClose={() => hideModal("command-palette")}
      />
      <SaveAsDialog />
      <ModalRenderer />
    </>
  );
};

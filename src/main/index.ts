import { join } from "node:path";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { CONFIRM_CLOSE_CHANNEL } from "../../shared/protocol/workspace";
import { forwardEngineEvents, registerEngineIpc } from "./engine/ipc";
import {
  chooseSocketPath,
  defaultSocketFilename,
  EngineSupervisor,
  resolveEnginePath,
} from "./engine/supervisor";
import { parseLaunchOptions } from "./launch-options";
import { registerAppStorageIpc } from "./storage/app-storage";
import { guardClose, registerWorkspaceIpc } from "./workspace/workspace-ipc";

let supervisor: EngineSupervisor | null = null;
const launch = parseLaunchOptions(process.argv);

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      sandbox: false,
    },
  });
  mainWindow.on("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
  return mainWindow;
}

/**
 * Starts the engine and wires it to a window.
 *
 * A failure to start is reported rather than thrown: the engine binary may simply not be built yet in a
 * fresh checkout, and an application that refuses to open its window over that gives the user nowhere to
 * read the reason. The renderer sees it on the same event channel as everything else.
 */
async function startEngine(window: BrowserWindow): Promise<void> {
  const socketPath = chooseSocketPath({
    userData: app.getPath("userData"),
    tmpDir: app.getPath("temp"),
    filename: defaultSocketFilename(),
  });
  const enginePath = resolveEnginePath({
    projectRoot: join(__dirname, "../.."),
    resourcesPath: process.resourcesPath,
  });

  supervisor = new EngineSupervisor({
    enginePath,
    socketPath,
    ...(launch.audio === null ? {} : { device: launch.audio }),
  });
  registerEngineIpc(ipcMain, supervisor);
  const stopForwarding = forwardEngineEvents(supervisor, window);
  window.on("closed", stopForwarding);

  try {
    await supervisor.start();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (window.isDestroyed()) return;
    window.webContents.send("engine:event", {
      event: "engine.error",
      seq: 0,
      data: { code: "E_IO", message: `the engine did not start: ${message}` },
    });
  }
}

app.whenReady().then(() => {
  electronApp.setAutoLaunch(false);
  app.on("browser-window-created", (_, window) =>
    optimizer.watchWindowShortcuts(window),
  );
  registerAppStorageIpc(ipcMain, app.getPath("userData"));
  const window = createWindow();
  registerWorkspaceIpc(ipcMain, {
    window,
    userData: app.getPath("userData"),
    launchWorkspace: launch.workspace,
  });
  // The window asks before it goes. The renderer owns the answer, because it is the only side that
  // knows which projects have unsaved work in them.
  guardClose(window, (target) =>
    target.webContents.send(CONFIRM_CLOSE_CHANNEL),
  );
  void startEngine(window);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

/**
 * Closing the socket is what tells the engine to exit and release the audio device (trap 3). Quitting
 * without it would leave a process holding the device until the machine is restarted, so the quit waits
 * for the supervisor to finish stopping.
 */
app.on("before-quit", (event) => {
  const running = supervisor;
  if (running === null) return;
  supervisor = null;
  event.preventDefault();
  void running.stop().finally(() => app.quit());
});

/**
 * Closing the window quits, on every platform including macOS.
 *
 * The usual macOS convention is to keep the application alive with no windows, and for most
 * applications that is right. This one owns a separate process that holds the audio device and is
 * making sound: leaving it running with nothing on screen means noise from an application you cannot
 * see, with no way to stop it short of finding it in the dock. Quitting stops the engine, because
 * `before-quit` closes the socket and the engine exits when its client goes away.
 */
app.on("window-all-closed", () => {
  app.quit();
});

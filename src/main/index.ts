import { join } from "node:path";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import { forwardEngineEvents, registerEngineIpc } from "./engine/ipc";
import {
  chooseSocketPath,
  defaultSocketFilename,
  EngineSupervisor,
  resolveEnginePath,
} from "./engine/supervisor";

let supervisor: EngineSupervisor | null = null;

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

  supervisor = new EngineSupervisor({ enginePath, socketPath });
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
  const window = createWindow();
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

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

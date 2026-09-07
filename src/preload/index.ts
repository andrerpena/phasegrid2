import { electronAPI } from "@electron-toolkit/preload";
import { contextBridge } from "electron";

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld("electron", electronAPI);
  contextBridge.exposeInMainWorld("api", {});
} else {
  // biome-ignore lint/suspicious/noExplicitAny: preload has window without DOM types
  const win = window as any;
  win.electron = electronAPI;
  win.api = {};
}

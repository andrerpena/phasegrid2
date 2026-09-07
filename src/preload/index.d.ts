import type { ElectronAPI } from "@electron-toolkit/preload";
import type { EngineBridge } from "./index";

declare global {
  interface Window {
    electron: ElectronAPI;
    /**
     * The engine, as the renderer sees it. `call` is typed from the shared command table, so the
     * argument and result types of every command are inferred from one definition rather than
     * restated here.
     */
    engine: EngineBridge;
  }
}

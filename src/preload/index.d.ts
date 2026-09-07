import type { ElectronAPI } from "@electron-toolkit/preload";
import type { EngineBridge, TelemetryBridge } from "./index";

declare global {
  interface Window {
    electron: ElectronAPI;
    /**
     * The engine, as the renderer sees it. `call` is typed from the shared command table, so the
     * argument and result types of every command are inferred from one definition rather than
     * restated here.
     */
    engine: EngineBridge;
    /**
     * The telemetry segment. `open` returns the header, or null when the bytes are not a layout this
     * build understands; `read` returns a decoded slot, or null when there is nothing fresh to draw.
     */
    telemetry: TelemetryBridge;
  }
}

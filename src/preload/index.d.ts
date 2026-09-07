import type { ElectronAPI } from "@electron-toolkit/preload";
import type {
  EngineBridge,
  TelemetryBridge,
} from "../../shared/protocol/bridge";

declare global {
  interface Window {
    electron: ElectronAPI;
    /** The engine, typed from the shared command table so both sides infer from one definition. */
    engine: EngineBridge;
    telemetry: TelemetryBridge;
  }
}

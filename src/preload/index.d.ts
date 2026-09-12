import type { ElectronAPI } from "@electron-toolkit/preload";
import type {
  EngineBridge,
  TelemetryBridge,
} from "../../shared/protocol/bridge";
import type { AppStorageBridge } from "../../shared/protocol/storage";
import type { WorkspaceBridge } from "../../shared/protocol/workspace";

declare global {
  interface Window {
    electron: ElectronAPI;
    /** The engine, typed from the shared command table so both sides infer from one definition. */
    engine: EngineBridge;
    telemetry: TelemetryBridge;
    /** The dock layout and the pointer to the workspace. Nothing else belongs to the installation. */
    appStorage: AppStorageBridge;
    /** The workspace folder: its settings, its projects, and the dialogs about them. */
    workspace: WorkspaceBridge;
  }
}

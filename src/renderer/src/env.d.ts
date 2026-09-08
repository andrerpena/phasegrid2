/// <reference types="vite/client" />
import type { EngineBridge, TelemetryBridge } from "@shared/protocol/bridge";
import type { AppStorageBridge } from "@shared/protocol/storage";
import type { WorkspaceBridge } from "@shared/protocol/workspace";

declare global {
  /** Injected by the bundler from package.json. */
  const __APP_VERSION__: string;

  interface Window {
    /** The engine, typed from the shared command table. Set up by the preload. */
    engine: EngineBridge;
    /** The telemetry segment, read directly rather than through a message per frame. */
    telemetry: TelemetryBridge;
    /** The dock layout and the pointer to the workspace. Nothing else belongs to the installation. */
    appStorage: AppStorageBridge;
    /** The workspace folder: its settings, its projects, and the dialogs about them. */
    workspace: WorkspaceBridge;
  }
}

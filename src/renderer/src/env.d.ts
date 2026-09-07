/// <reference types="vite/client" />
import type { EngineBridge, TelemetryBridge } from "@shared/protocol/bridge";
import type { AppStorageBridge } from "@shared/protocol/storage";

declare global {
  /** Injected by the bundler from package.json. */
  const __APP_VERSION__: string;

  interface Window {
    /** The engine, typed from the shared command table. Set up by the preload. */
    engine: EngineBridge;
    /** The telemetry segment, read directly rather than through a message per frame. */
    telemetry: TelemetryBridge;
    /** Application settings: keybindings, layout and the chosen theme. Not project data. */
    appStorage: AppStorageBridge;
  }
}

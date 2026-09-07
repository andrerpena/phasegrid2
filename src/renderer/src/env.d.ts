/// <reference types="vite/client" />
import type { EngineBridge, TelemetryBridge } from "@shared/protocol/bridge";

declare global {
  /** Injected by the bundler from package.json. */
  const __APP_VERSION__: string;

  interface Window {
    /** The engine, typed from the shared command table. Set up by the preload. */
    engine: EngineBridge;
    /** The telemetry segment, read directly rather than through a message per frame. */
    telemetry: TelemetryBridge;
  }
}

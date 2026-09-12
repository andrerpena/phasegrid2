/**
 * The contract between the preload and the renderer.
 *
 * It lives in `shared` rather than in either process because both need it and neither should import the
 * other: the renderer must not pull main-process modules into its build, and the main process has no
 * business depending on renderer code. What crosses the boundary is described once, here.
 */

import type { CommandArgs, CommandName, CommandResult } from "./commands";
import type { EventEnvelope } from "./envelope";
import type { SlotReading, TelemetryHeader } from "./telemetry";

/** `ipcRenderer.invoke` on one side, `ipcMain.handle` on the other. */
export const ENGINE_CALL_CHANNEL = "engine:call";
/** Main to renderer, one message per engine event. */
export const ENGINE_EVENT_CHANNEL = "engine:event";

/**
 * What crosses the boundary in place of a rejected promise.
 *
 * Electron serializes a thrown error by its message alone, so an error would arrive with its `code`
 * stripped and its message wrapped. The code is the part callers branch on, so a failure travels as
 * data and the preload turns it back into an error on the far side.
 */
export type EngineCallResult<C extends CommandName> =
  | { ok: true; result: CommandResult<C> }
  | { ok: false; error: { code: string; message: string } };

/** What the renderer sees as `window.engine`. */
export interface EngineBridge {
  call<C extends CommandName>(
    cmd: C,
    args: CommandArgs<C>,
  ): Promise<CommandResult<C>>;
  /** Returns the unsubscribe. */
  onEvent(listener: (event: EventEnvelope) => void): () => void;
}

/** What the renderer sees as `window.telemetry`. */
export interface TelemetryBridge {
  /** Maps the segment. Null when the bytes are not a layout this build understands. */
  open(name: string, byteLength: number): TelemetryHeader | null;
  /** One slot, or null when there is nothing fresh and complete to draw. */
  read(index: number): SlotReading | null;
  close(): void;
}

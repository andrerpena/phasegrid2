import type { BrowserWindow, IpcMain } from "electron";
import type {
  CommandArgs,
  CommandName,
  CommandResult,
} from "../../../shared/protocol/commands";
import { isCommandName } from "../../../shared/protocol/commands";
import type { EventEnvelope } from "../../../shared/protocol/envelope";
import type { EngineSupervisor } from "./supervisor";

/** `ipcRenderer.invoke` on one side, `ipcMain.handle` on the other. */
export const ENGINE_CALL_CHANNEL = "engine:call";
/** Main to renderer, one message per engine event. */
export const ENGINE_EVENT_CHANNEL = "engine:event";

/**
 * What crosses the IPC boundary in place of a rejected promise.
 *
 * Electron serializes a thrown error by its message alone, so an `EngineError` arrives in the renderer
 * as a plain `Error` whose `code` is gone and whose message has been prefixed with Electron's own
 * wrapper text. The code is the part callers branch on, so the result travels as data and the preload
 * turns it back into an error on the far side.
 */
export type EngineCallResult<C extends CommandName> =
  | { ok: true; result: CommandResult<C> }
  | { ok: false; error: { code: string; message: string } };

function describe(error: unknown): { code: string; message: string } {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return {
      code: typeof code === "string" ? code : "E_IO",
      message: error.message,
    };
  }
  return { code: "E_IO", message: String(error) };
}

/** The subset of `EngineSupervisor` this module needs, so a test does not have to build a real one. */
export interface EngineCaller {
  call<C extends CommandName>(
    cmd: C,
    args: CommandArgs<C>,
  ): Promise<CommandResult<C>>;
  onEvent(listener: (event: EventEnvelope) => void): () => void;
}

/**
 * Answers `engine:call` from the renderer.
 *
 * The command name is checked against the shared table before it reaches the supervisor. The renderer
 * is typed, but IPC is a boundary and a boundary that trusts its input is not a boundary; an unknown
 * name has to come back as a protocol error rather than as an exception from somewhere deeper.
 */
export function registerEngineIpc(
  ipcMain: IpcMain,
  supervisor: EngineCaller,
): void {
  ipcMain.handle(
    ENGINE_CALL_CHANNEL,
    async (
      _event,
      cmd: unknown,
      args: unknown,
    ): Promise<EngineCallResult<CommandName>> => {
      if (typeof cmd !== "string" || !isCommandName(cmd))
        return {
          ok: false,
          error: { code: "E_UNKNOWN_CMD", message: `unknown command ${cmd}` },
        };
      try {
        const result = await supervisor.call(
          cmd,
          args as CommandArgs<typeof cmd>,
        );
        return { ok: true, result };
      } catch (error) {
        return { ok: false, error: describe(error) };
      }
    },
  );
}

/**
 * Forwards engine events to a window until that window goes away.
 *
 * The destroyed check is not paranoia: the supervisor outlives any single window, and sending to a
 * destroyed one throws. Returns the unsubscribe so the caller can drop the listener on close.
 */
export function forwardEngineEvents(
  supervisor: EngineCaller,
  window: BrowserWindow,
): () => void {
  return supervisor.onEvent((event) => {
    if (window.isDestroyed()) return;
    window.webContents.send(ENGINE_EVENT_CHANNEL, event);
  });
}

/** Narrower than `EngineSupervisor` on purpose; this is the only place the two are tied together. */
export type SupervisorLike = EngineSupervisor & EngineCaller;

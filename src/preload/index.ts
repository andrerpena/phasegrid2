import { electronAPI } from "@electron-toolkit/preload";
import { contextBridge, ipcRenderer } from "electron";
import type {
  CommandArgs,
  CommandName,
  CommandResult,
} from "../../shared/protocol/commands";
import type { EventEnvelope } from "../../shared/protocol/envelope";
import {
  ENGINE_CALL_CHANNEL,
  ENGINE_EVENT_CHANNEL,
  type EngineCallResult,
} from "../main/engine/ipc";

/**
 * An engine error, rebuilt on this side of IPC.
 *
 * Electron cannot carry a custom error across the boundary, so the main process sends the failure as
 * data and this turns it back into something with a `code` on it. The renderer branches on the code,
 * never on the message text.
 */
class EngineError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "EngineError";
    this.code = code;
  }
}

async function call<C extends CommandName>(
  cmd: C,
  args: CommandArgs<C>,
): Promise<CommandResult<C>> {
  const answer: EngineCallResult<C> = await ipcRenderer.invoke(
    ENGINE_CALL_CHANNEL,
    cmd,
    args,
  );
  if (!answer.ok)
    throw new EngineError(answer.error.code, answer.error.message);
  return answer.result;
}

/**
 * Subscribes to engine events and returns the unsubscribe.
 *
 * The listener is wrapped rather than passed through, so the renderer never receives Electron's
 * `IpcRendererEvent`. Handing that over would leak `sender`, and with it a path back into the main
 * process that the isolated world is supposed to have been cut off from.
 */
function onEvent(listener: (event: EventEnvelope) => void): () => void {
  const wrapped = (_ipcEvent: unknown, event: EventEnvelope): void =>
    listener(event);
  ipcRenderer.on(ENGINE_EVENT_CHANNEL, wrapped);
  return () => {
    ipcRenderer.off(ENGINE_EVENT_CHANNEL, wrapped);
  };
}

const engine = { call, onEvent };

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld("electron", electronAPI);
  contextBridge.exposeInMainWorld("engine", engine);
} else {
  const win = window as unknown as Record<string, unknown>;
  win.electron = electronAPI;
  win.engine = engine;
}

export type EngineBridge = typeof engine;

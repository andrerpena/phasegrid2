import { electronAPI } from "@electron-toolkit/preload";
import { contextBridge, ipcRenderer } from "electron";
import {
  ENGINE_CALL_CHANNEL,
  ENGINE_EVENT_CHANNEL,
  type EngineBridge,
  type EngineCallResult,
  type TelemetryBridge,
} from "../../shared/protocol/bridge";
import type {
  CommandArgs,
  CommandName,
  CommandResult,
} from "../../shared/protocol/commands";
import type { EventEnvelope } from "../../shared/protocol/envelope";
import {
  decodeSlot,
  readHeader,
  type SlotReading,
  slotOffset,
  TELEMETRY_HEADER_BYTES,
  TELEMETRY_SLOT_BYTES,
  type TelemetryHeader,
} from "../../shared/protocol/telemetry";

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

const engine: EngineBridge = { call, onEvent };

/**
 * The telemetry segment, read straight from the renderer.
 *
 * This is the reason the addon exists. A meter redrawn at frame rate through IPC would be a message
 * round trip per frame per meter; here the renderer reads the same memory the audio thread wrote, with
 * no hop at all. The addon copies out of the mapping rather than exposing a view, so what a caller
 * decodes cannot change underneath it while it is decoding.
 *
 * Loaded lazily. A renderer with no meters on screen never pays for it, and a build where the addon
 * failed to compile still runs everything else.
 */
let segment: {
  read(offset: number, length: number): Buffer;
  close(): void;
} | null = null;

function openSegment(name: string, byteLength: number): TelemetryHeader | null {
  closeSegment();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const addon = require("../../native/index.cjs") as {
    open(
      name: string,
      byteLength: number,
    ): {
      read(offset: number, length: number): Buffer;
      close(): void;
    };
  };
  const opened = addon.open(name, byteLength);
  const head = opened.read(0, TELEMETRY_HEADER_BYTES);
  const header = readHeader(
    new DataView(head.buffer, head.byteOffset, head.byteLength),
  );
  if (header === null) {
    // A segment this build cannot read is not a segment. Closing rather than keeping it means a caller
    // cannot later read slots out of bytes whose layout was never verified.
    opened.close();
    return null;
  }
  segment = opened;
  return header;
}

function readSlot(index: number): SlotReading | null {
  if (segment === null) return null;
  try {
    const bytes = segment.read(slotOffset(index), TELEMETRY_SLOT_BYTES);
    return decodeSlot(
      new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    );
  } catch {
    // An out-of-range slot throws in the addon. A display asking for a slot it no longer owns should
    // draw nothing, not tear down the renderer.
    return null;
  }
}

function closeSegment(): void {
  segment?.close();
  segment = null;
}

const telemetry: TelemetryBridge = {
  open: openSegment,
  read: readSlot,
  close: closeSegment,
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld("electron", electronAPI);
  contextBridge.exposeInMainWorld("engine", engine);
  contextBridge.exposeInMainWorld("telemetry", telemetry);
} else {
  const win = window as unknown as Record<string, unknown>;
  win.electron = electronAPI;
  win.engine = engine;
  win.telemetry = telemetry;
}

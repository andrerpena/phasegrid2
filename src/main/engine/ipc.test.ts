import type { BrowserWindow, IpcMain } from "electron";
import { describe, expect, it, vi } from "vitest";
import type { EventEnvelope } from "../../../shared/protocol/envelope";
import {
  ENGINE_CALL_CHANNEL,
  ENGINE_EVENT_CHANNEL,
  type EngineCaller,
  forwardEngineEvents,
  registerEngineIpc,
} from "./ipc";

type Handler = (
  event: unknown,
  cmd: unknown,
  args: unknown,
) => Promise<unknown>;

/** Just enough of `ipcMain` to capture the handler and call it the way Electron would. */
function fakeIpcMain(): { ipcMain: IpcMain; invoke: Handler } {
  let handler: Handler | null = null;
  const ipcMain = {
    handle(channel: string, fn: Handler) {
      expect(channel).toBe(ENGINE_CALL_CHANNEL);
      handler = fn;
    },
  } as unknown as IpcMain;
  return {
    ipcMain,
    invoke: (event, cmd, args) => {
      if (handler === null) throw new Error("no handler was registered");
      return handler(event, cmd, args);
    },
  };
}

function caller(
  call: EngineCaller["call"],
): EngineCaller & { emit(event: EventEnvelope): void } {
  const listeners = new Set<(event: EventEnvelope) => void>();
  return {
    call,
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(event) {
      for (const listener of listeners) listener(event);
    },
  };
}

const succeed = (async () => ({
  pong: true,
})) as unknown as EngineCaller["call"];

describe("the engine IPC bridge", () => {
  it("passes a known command through and returns its result", async () => {
    const call = vi.fn(succeed);
    const { ipcMain, invoke } = fakeIpcMain();
    registerEngineIpc(ipcMain, caller(call));

    const answer = await invoke(null, "engine.ping", {});

    expect(answer).toEqual({ ok: true, result: { pong: true } });
    expect(call).toHaveBeenCalledWith("engine.ping", {});
  });

  it("rejects a command name that is not in the shared table, without asking the engine", async () => {
    const call = vi.fn(succeed);
    const { ipcMain, invoke } = fakeIpcMain();
    registerEngineIpc(ipcMain, caller(call));

    const answer = (await invoke(null, "patch.deleteEverything", {})) as {
      ok: false;
      error: { code: string };
    };

    // IPC is a boundary. The renderer is typed, but a typed caller is not a guarantee about what
    // arrives, and an unknown name must come back as a protocol error rather than reach the supervisor.
    expect(answer.ok).toBe(false);
    expect(answer.error.code).toBe("E_UNKNOWN_CMD");
    expect(call).not.toHaveBeenCalled();
  });

  it("carries an engine error's code across the boundary instead of only its message", async () => {
    const failure = Object.assign(new Error("no such module 'osc'"), {
      code: "E_NODE_NOT_FOUND",
    });
    const { ipcMain, invoke } = fakeIpcMain();
    registerEngineIpc(
      ipcMain,
      caller((() => Promise.reject(failure)) as EngineCaller["call"]),
    );

    const answer = await invoke(null, "module.remove", { module: "osc" });

    // The code is the part a caller branches on. Throwing across IPC would drop it.
    expect(answer).toEqual({
      ok: false,
      error: { code: "E_NODE_NOT_FOUND", message: "no such module 'osc'" },
    });
  });

  it("labels a failure that carries no code, rather than passing undefined along", async () => {
    const { ipcMain, invoke } = fakeIpcMain();
    registerEngineIpc(
      ipcMain,
      caller((() =>
        Promise.reject(new Error("socket hung up"))) as EngineCaller["call"]),
    );

    const answer = (await invoke(null, "engine.ping", {})) as {
      ok: false;
      error: { code: string; message: string };
    };

    expect(answer.error).toEqual({ code: "E_IO", message: "socket hung up" });
  });

  it("forwards engine events to the window until it is destroyed", () => {
    const send = vi.fn();
    let destroyed = false;
    const window = {
      isDestroyed: () => destroyed,
      webContents: { send },
    } as unknown as BrowserWindow;
    const engine = caller(succeed);
    forwardEngineEvents(engine, window);

    const ready: EventEnvelope = {
      event: "engine.ready",
      seq: 1,
      data: { protocolVersion: 1 },
    };
    engine.emit(ready);
    expect(send).toHaveBeenCalledWith(ENGINE_EVENT_CHANNEL, ready);

    // The supervisor outlives any one window, and sending to a destroyed window throws.
    destroyed = true;
    engine.emit({ ...ready, seq: 2 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("stops forwarding once the subscription is released", () => {
    const send = vi.fn();
    const window = {
      isDestroyed: () => false,
      webContents: { send },
    } as unknown as BrowserWindow;
    const engine = caller(succeed);
    const stop = forwardEngineEvents(engine, window);

    stop();
    engine.emit({
      event: "engine.ready",
      seq: 1,
      data: { protocolVersion: 1 },
    });

    expect(send).not.toHaveBeenCalled();
  });
});

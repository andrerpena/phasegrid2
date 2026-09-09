import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserWindow, IpcMain } from "electron";
import { beforeEach, describe, expect, it } from "vitest";
import type { DialogHost } from "./dialogs";
import { registerWorkspaceIpc, resetWorkspaceState } from "./workspace-ipc";

/**
 * The channel with a fake `ipcMain`: the handler is captured and called directly. No window is ever
 * touched by the ops exercised here, so a bare object stands in for one.
 */
type Handler = (
  event: unknown,
  op: unknown,
  ...args: unknown[]
) => Promise<unknown>;

function channel(host: {
  userData: string;
  launchWorkspace?: string | null;
  dialogs?: DialogHost;
}): (op: string, ...args: unknown[]) => Promise<unknown> {
  let handler: Handler | null = null;
  const ipcMain = {
    handle: (_channel: string, fn: Handler) => {
      handler = fn;
    },
  } as unknown as IpcMain;
  registerWorkspaceIpc(ipcMain, {
    window: {} as BrowserWindow,
    ...host,
  });
  return (op, ...args) => {
    if (handler === null) throw new Error("no handler registered");
    return handler({}, op, ...args);
  };
}

let userData = "";
let folder = "";
beforeEach(async () => {
  resetWorkspaceState();
  userData = await mkdtemp(join(tmpdir(), "pg-ud-"));
  folder = await mkdtemp(join(tmpdir(), "pg-launch-ws-"));
});

describe("a workspace named on the command line", () => {
  it("is what `current` answers, scaffolded if need be", async () => {
    const call = channel({ userData, launchWorkspace: folder });
    const answer = (await call("current")) as {
      ok: boolean;
      value: { root: string } | null;
    };
    expect(answer.ok).toBe(true);
    expect(answer.value?.root).toBe(folder);
    expect(await readdir(folder)).toContain("workspace.json");
  });

  it("is not remembered", async () => {
    // A scripted run must not become the workspace the person finds open next time.
    const call = channel({ userData, launchWorkspace: folder });
    await call("current");
    expect(await readdir(userData)).toEqual([]);
  });

  it("is absent by default, so the pointer decides", async () => {
    const call = channel({ userData });
    const answer = (await call("current")) as { ok: boolean; value: unknown };
    expect(answer).toEqual({ ok: true, value: null });
  });

  it("lets later ops use it as the root", async () => {
    const call = channel({ userData, launchWorkspace: folder });
    await call("current");
    const listed = (await call("listProjects")) as {
      ok: boolean;
      value: unknown[];
    };
    expect(listed).toEqual({ ok: true, value: [] });
  });
});

describe("answering a dialog ahead of time", () => {
  const native: DialogHost = {
    chooseWorkspaceFolder: async () => null,
    confirmUnsaved: async () => "cancel",
    confirmDelete: async () => false,
  };

  it("makes the next question of that kind return the queued answer", async () => {
    const call = channel({
      userData,
      launchWorkspace: folder,
      dialogs: native,
    });
    expect(await call("answerDialog", "confirmUnsaved", "discard")).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await call("confirmUnsaved", ["A"])).toEqual({
      ok: true,
      value: "discard",
    });
    // Consumed: the one after is the native host's.
    expect(await call("confirmUnsaved", ["A"])).toEqual({
      ok: true,
      value: "cancel",
    });
  });

  it("refuses a kind it does not know and an answer of no shape", async () => {
    const call = channel({ userData, dialogs: native });
    expect(
      (await call("answerDialog", "confirmEverything", true)) as {
        ok: boolean;
      },
    ).toMatchObject({ ok: false });
    expect(
      (await call("answerDialog", "confirmDelete", { yes: true })) as {
        ok: boolean;
      },
    ).toMatchObject({ ok: false });
  });

  it("lets a script pick the workspace folder", async () => {
    const call = channel({ userData, dialogs: native });
    await call("answerDialog", "chooseWorkspace", folder);
    const chosen = (await call("choose")) as {
      ok: boolean;
      value: { root: string } | null;
    };
    expect(chosen.value?.root).toBe(folder);
  });
});

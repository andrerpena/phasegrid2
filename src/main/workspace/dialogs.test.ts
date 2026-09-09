import type { BrowserWindow } from "electron";
import { describe, expect, it, vi } from "vitest";
import { type DialogHost, scriptedDialogs } from "./dialogs";

const window = {} as BrowserWindow;

function fallback(): DialogHost & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    chooseWorkspaceFolder: vi.fn(async () => {
      calls.push("choose");
      return "/native/pick";
    }),
    confirmUnsaved: vi.fn(async () => {
      calls.push("unsaved");
      return "cancel" as const;
    }),
    confirmDelete: vi.fn(async () => {
      calls.push("delete");
      return false;
    }),
  };
}

describe("scripted dialogs", () => {
  it("asks the native host when nothing is queued", async () => {
    const native = fallback();
    const host = scriptedDialogs(native);
    expect(await host.chooseWorkspaceFolder(window)).toBe("/native/pick");
    expect(await host.confirmUnsaved(window, ["A"])).toBe("cancel");
    expect(await host.confirmDelete(window, "A")).toBe(false);
    expect(native.calls).toEqual(["choose", "unsaved", "delete"]);
  });

  it("answers from the queue, once per answer, in order", async () => {
    const native = fallback();
    const host = scriptedDialogs(native);
    host.answer("confirmUnsaved", "discard");
    host.answer("confirmUnsaved", "save");
    expect(host.pending().confirmUnsaved).toBe(2);
    expect(await host.confirmUnsaved(window, ["A"])).toBe("discard");
    expect(await host.confirmUnsaved(window, ["A"])).toBe("save");
    // The queue is empty again, so the third question is the person's.
    expect(await host.confirmUnsaved(window, ["A"])).toBe("cancel");
    expect(native.calls).toEqual(["unsaved"]);
  });

  it("keeps the kinds apart", async () => {
    const native = fallback();
    const host = scriptedDialogs(native);
    host.answer("confirmDelete", true);
    host.answer("chooseWorkspace", "/scripted/ws");
    expect(await host.confirmUnsaved(window, ["A"])).toBe("cancel");
    expect(await host.confirmDelete(window, "A")).toBe(true);
    expect(await host.chooseWorkspaceFolder(window)).toBe("/scripted/ws");
    expect(native.calls).toEqual(["unsaved"]);
  });

  it("lets a folder choice be cancelled by script", async () => {
    const host = scriptedDialogs(fallback());
    host.answer("chooseWorkspace", null);
    expect(await host.chooseWorkspaceFolder(window)).toBeNull();
  });

  it("falls through to the native host on an answer of the wrong shape", async () => {
    // A boolean queued for the unsaved box is a scripting mistake; it must not become "save".
    const native = fallback();
    const host = scriptedDialogs(native);
    host.answer("confirmUnsaved", true);
    expect(await host.confirmUnsaved(window, ["A"])).toBe("cancel");
    expect(native.calls).toEqual(["unsaved"]);
  });
});

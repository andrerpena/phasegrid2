import { useEngineStore } from "@renderer/engine/engine-store";
import { usePatchStore } from "@renderer/patch/patch-store";
import { EMPTY_PATCH } from "@shared/protocol/patch";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { startPreviewSync } from "./preview-sync";

/**
 * When the panels ask, and how often.
 *
 * What a panel shows is the engine's business and is tested there. What is tested here is that a
 * panel is asked for at the right moments and not at every one of them.
 */

const calls: string[] = [];
const shown = new Map<string, ArrayLike<number>>();
const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => {
  calls.length = 0;
  shown.clear();
  Object.assign(globalThis, {
    window: { engine: { onEvent: () => () => {} } },
  });
  useEngineStore.setState({
    // An engine that does not publish pictures: the request path is the one in use.
    capabilities: ["patch", "transport", "telemetry"],
    call: vi.fn(async (cmd: string, args: { module?: string }) => {
      calls.push(`${cmd} ${args.module ?? ""}`);
      return { samples: [-1, 0, 1], revision: 1 } as never;
    }) as never,
  });
  usePatchStore.setState({ doc: EMPTY_PATCH, version: 0 });
});

const target = {
  previewing: () => ["saw"],
  setPreview: (id: string, samples: ArrayLike<number>) =>
    shown.set(id, samples),
};

describe("preview sync", () => {
  it("puts what the engine drew onto the panel", async () => {
    const sync = startPreviewSync(target);
    sync.refresh("saw");
    await flush();
    sync.stop();
    expect(calls).toEqual(["module.preview saw"]);
    expect(Array.from(shown.get("saw") ?? [])).toEqual([-1, 0, 1]);
  });

  it("collapses a burst of changes into one request and one follow-up", async () => {
    // Three moves while the first answer is still on its way: the second and third are the same
    // question, so one more request after the first answers is enough, and it asks for the latest.
    const sync = startPreviewSync(target);
    sync.refresh("saw");
    sync.refresh("saw");
    sync.refresh("saw");
    await flush();
    sync.stop();
    expect(calls).toEqual(["module.preview saw", "module.preview saw"]);
  });

  it("asks again when a parameter is set through the document", async () => {
    const sync = startPreviewSync(target);
    usePatchStore
      .getState()
      .apply([{ op: "paramSet", module: "saw", param: "sync", value: 7 }]);
    await flush();
    sync.stop();
    expect(calls).toEqual(["module.preview saw"]);
  });

  it("asks for every panel when a project opens", async () => {
    const sync = startPreviewSync(target);
    usePatchStore.getState().replace(EMPTY_PATCH);
    await flush();
    sync.stop();
    expect(calls).toEqual(["module.preview saw"]);
  });

  it("asks nothing once stopped", async () => {
    const sync = startPreviewSync(target);
    sync.stop();
    sync.refresh("saw");
    await flush();
    expect(calls).toEqual([]);
  });

  it("asks for nothing once the engine publishes pictures itself", async () => {
    useEngineStore.setState({
      capabilities: ["patch", "transport", "telemetry", "previews"],
    });
    const sync = startPreviewSync(target);
    sync.refresh("saw");
    await flush();
    sync.stop();
    expect(calls).toEqual([]);
  });
});

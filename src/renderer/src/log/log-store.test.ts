import { beforeEach, describe, expect, it } from "vitest";
import { entryForEvent, useLogStore } from "./log-store";

beforeEach(() => {
  useLogStore.setState({ entries: [], limit: 500 });
});

describe("the log store", () => {
  it("keeps what it is given, oldest first, and tails from the end", () => {
    const store = useLogStore.getState();
    store.push({ level: "info", source: "engine", message: "one" });
    store.push({ level: "warn", source: "app", message: "two" });
    store.push({ level: "error", source: "renderer", message: "three" });
    expect(store.tail(2).map((e) => e.message)).toEqual(["two", "three"]);
    expect(store.tail(10)).toHaveLength(3);
    expect(store.tail(0)).toEqual([]);
  });

  it("is bounded", () => {
    useLogStore.setState({ limit: 3 });
    for (const n of [1, 2, 3, 4, 5])
      useLogStore
        .getState()
        .push({ level: "info", source: "engine", message: String(n) });
    expect(useLogStore.getState().entries.map((e) => e.message)).toEqual([
      "3",
      "4",
      "5",
    ]);
  });

  it("stamps a time", () => {
    useLogStore
      .getState()
      .push({ level: "info", source: "engine", message: "x" });
    expect(useLogStore.getState().entries[0]?.time).toBeTypeOf("number");
  });
});

describe("an engine event as a log line", () => {
  it("passes an engine log line through with its level", () => {
    expect(
      entryForEvent({
        event: "engine.log",
        seq: 1,
        data: { level: "warn", message: "restarting" },
      }),
    ).toEqual({ level: "warn", source: "engine", message: "restarting" });
  });

  it("marks errors and crashes as errors", () => {
    expect(
      entryForEvent({
        event: "engine.error",
        seq: 1,
        data: { code: "E_IO", message: "gone" },
      }),
    ).toEqual({ level: "error", source: "engine", message: "E_IO: gone" });
    expect(
      entryForEvent({
        event: "engine.crashed",
        seq: 1,
        data: { message: "five failures" },
      })?.level,
    ).toBe("error");
  });

  it("says when a restarted engine reconnects, and not when it is first ready", () => {
    // `engine.ready` itself is not a line: it is sent before the window listens, and the handshake
    // is recorded from the engine store instead.
    expect(
      entryForEvent({
        event: "engine.ready",
        seq: 1,
        data: {
          engineVersion: "0.1.0",
          sampleRate: 48000,
          channels: 2,
          blockSize: 64,
        },
      }),
    ).toBeNull();
    expect(
      entryForEvent({
        event: "engine.connected",
        seq: 1,
        data: { restarted: true },
      })?.message,
    ).toContain("restarted");
  });

  it("ignores the position, which would otherwise be the whole log", () => {
    expect(
      entryForEvent({ event: "transport.position", seq: 1, data: {} }),
    ).toBeNull();
    expect(
      entryForEvent({ event: "patch.revision", seq: 1, data: { revision: 3 } }),
    ).toBeNull();
  });

  it("does not trust the level it is handed", () => {
    expect(
      entryForEvent({
        event: "engine.log",
        seq: 1,
        data: { level: "loud", message: "?" },
      })?.level,
    ).toBe("info");
  });
});

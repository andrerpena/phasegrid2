import { useEngineStore } from "@renderer/engine/engine-store";
import type { EventEnvelope } from "@shared/protocol/envelope";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTransportStore, watchTransport } from "./transport-store";

/** What reached the engine, in order, as `name(args)` strings. */
let sent: string[] = [];

beforeEach(() => {
  sent = [];
  useTransportStore.setState({ playing: false });
  useEngineStore.setState({
    call: vi.fn(async (cmd: string, args: unknown) => {
      sent.push(`${cmd}(${JSON.stringify(args)})`);
      return {} as never;
    }) as never,
    setRunning: vi.fn(async (running: boolean) => {
      sent.push(`running(${running})`);
    }),
  });
});

describe("the transport store", () => {
  it("plays and stops with the three calls the engine needs, in that order", () => {
    useTransportStore.getState().play();
    expect(useTransportStore.getState().playing).toBe(true);
    expect(sent).toEqual([
      "transport.play({})",
      "running(true)",
      'audio.setOutputGain({"gain":1})',
    ]);
    sent = [];
    useTransportStore.getState().stop();
    expect(useTransportStore.getState().playing).toBe(false);
    expect(sent).toEqual([
      "transport.stop({})",
      "running(false)",
      'audio.setOutputGain({"gain":0})',
    ]);
  });

  it("toggles", () => {
    useTransportStore.getState().toggle();
    expect(useTransportStore.getState().playing).toBe(true);
    useTransportStore.getState().toggle();
    expect(useTransportStore.getState().playing).toBe(false);
  });
});

describe("watching the transport", () => {
  function events() {
    const listeners = new Set<(event: EventEnvelope) => void>();
    return {
      onEvent: (l: (event: EventEnvelope) => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      say: (event: EventEnvelope) => {
        for (const l of listeners) l(event);
      },
      listeners,
    };
  }

  it("tells the engine the current state at once, so a fresh engine does not play unasked", () => {
    const e = events();
    const stop = watchTransport(e.onEvent);
    expect(sent).toEqual([
      "transport.stop({})",
      "running(false)",
      'audio.setOutputGain({"gain":0})',
    ]);
    stop();
    expect(e.listeners.size).toBe(0);
  });

  it("tells a restarted engine again", () => {
    const e = events();
    watchTransport(e.onEvent);
    useTransportStore.getState().play();
    sent = [];
    e.say({
      event: "engine.ready",
      seq: 2,
      data: {
        engineVersion: "x",
        sampleRate: 48000,
        channels: 2,
        blockSize: 64,
      },
    });
    expect(sent[0]).toBe("transport.play({})");
  });

  it("follows the engine's own playing flag without talking back", () => {
    const e = events();
    watchTransport(e.onEvent);
    sent = [];
    e.say({ event: "transport.position", seq: 3, data: { playing: true } });
    expect(useTransportStore.getState().playing).toBe(true);
    // Following is not asking: echoing the engine's state back to it would be a loop.
    expect(sent).toEqual([]);
  });
});

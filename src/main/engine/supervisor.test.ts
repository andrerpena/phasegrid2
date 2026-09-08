import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CommandArgs,
  CommandName,
  CommandResult,
} from "../../../shared/protocol/commands";
import type { EventEnvelope } from "../../../shared/protocol/envelope";
import { PROTOCOL_VERSION } from "../../../shared/protocol/version";
import {
  type EngineClient,
  EngineError,
  type EngineEventListener,
} from "./socket-client";
import {
  chooseSocketPath,
  type EngineProcessHandle,
  EngineSupervisor,
  type LogLevel,
  MAX_UNIX_SOCKET_PATH,
  resolveEnginePath,
} from "./supervisor";

/**
 * No engine binary, no socket and no real time: the spawn and the client are injected, and the clock is
 * fake, so a test about sixty-second crash windows finishes in a millisecond.
 */

const HELLO: CommandResult<"hello"> = {
  protocolVersion: PROTOCOL_VERSION,
  engineVersion: "0.1.0-test",
  catalogHash: "0123456789abcdef",
  conventions: {
    octavesPerUnit: 10,
    middleCHz: 261.6256,
    gateThreshold: 0,
    blockSize: 128,
    lanes: ["v0.L", "v0.R", "v1.L", "v1.R"],
  },
  shm: null,
  capabilities: ["patch"],
};

let nextPid = 1000;

class FakeProcess implements EngineProcessHandle {
  readonly pid = nextPid++;
  exited = false;
  readonly signals: NodeJS.Signals[] = [];
  private readonly exitListeners = new Set<
    (code: number | null, signal: NodeJS.Signals | null) => void
  >();
  private readonly logListeners = new Set<
    (level: LogLevel, line: string) => void
  >();
  private code: number | null = null;
  private signal: NodeJS.Signals | null = null;

  kill(signal: NodeJS.Signals = "SIGTERM"): void {
    this.signals.push(signal);
    this.exit(null, signal);
  }
  onExit(
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): void {
    if (this.exited) listener(this.code, this.signal);
    else this.exitListeners.add(listener);
  }
  onLog(listener: (level: LogLevel, line: string) => void): void {
    this.logListeners.add(listener);
  }

  /** What the test drives: the process dies. */
  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.exited) return;
    this.exited = true;
    this.code = code;
    this.signal = signal;
    for (const listener of [...this.exitListeners]) listener(code, signal);
  }
  say(level: LogLevel, line: string): void {
    for (const listener of [...this.logListeners]) listener(level, line);
  }
}

class FakeClient implements EngineClient {
  connected = false;
  closed = false;
  readonly calls: string[] = [];
  /** How many connects to refuse before letting one through: an engine still opening its device. */
  refusals = 0;
  hello: CommandResult<"hello"> = HELLO;
  private readonly listeners = new Set<EngineEventListener>();

  async connect(): Promise<void> {
    if (this.refusals > 0) {
      this.refusals--;
      throw new EngineError("E_IO", "ENOENT");
    }
    this.connected = true;
  }
  call<C extends CommandName>(
    cmd: C,
    _args: CommandArgs<C>,
  ): Promise<CommandResult<C>> {
    this.calls.push(cmd);
    if (cmd === "hello") return Promise.resolve(this.hello as CommandResult<C>);
    return Promise.resolve({ revision: 1 } as CommandResult<C>);
  }
  onEvent(listener: EngineEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  close(): void {
    this.closed = true;
    this.connected = false;
  }
  /** What the test drives: the engine says something. */
  say(event: EventEnvelope): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}

interface Harness {
  supervisor: EngineSupervisor;
  processes: FakeProcess[];
  clients: FakeClient[];
  events: EventEnvelope[];
  args: string[][];
}

function harness(overrides: { refusals?: number } = {}): Harness {
  const processes: FakeProcess[] = [];
  const clients: FakeClient[] = [];
  const events: EventEnvelope[] = [];
  const args: string[][] = [];

  const supervisor = new EngineSupervisor({
    enginePath: "/opt/phasegrid/phasegrid-engine",
    socketPath: "/tmp/pg-test.sock",
    spawnEngine: (_binary, spawnArgs) => {
      args.push(spawnArgs);
      const process = new FakeProcess();
      processes.push(process);
      return process;
    },
    createClient: () => {
      const client = new FakeClient();
      client.refusals = overrides.refusals ?? 0;
      clients.push(client);
      return client;
    },
    connectDelayMs: 10,
    connectAttempts: 20,
  });
  supervisor.onEvent((event) => events.push(event));
  return { supervisor, processes, clients, events, args };
}

const named = (events: EventEnvelope[], name: string): EventEnvelope[] =>
  events.filter((event) => event.event === name);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the socket path (trap 1)", () => {
  const filename = "pg-1234.sock";

  it("uses the application's own data directory when it fits", () => {
    const path = chooseSocketPath({
      userData: "/Users/x/Library/Application Support/phasegrid2",
      tmpDir: "/var/folders/tmp",
      filename,
    });
    expect(path).toBe(
      "/Users/x/Library/Application Support/phasegrid2/pg-1234.sock",
    );
  });

  it("falls back to the temporary directory when the path would not fit", () => {
    // `bind` truncates silently rather than failing, so an unmeasured path binds a socket nobody can
    // find. This is the case the measurement exists for.
    const userData = `/Users/${"a".repeat(80)}/Library/Application Support/phasegrid2`;
    expect(
      chooseSocketPath({ userData, tmpDir: "/var/folders/tmp", filename }),
    ).toBe("/var/folders/tmp/pg-1234.sock");
  });

  it("measures bytes rather than characters", () => {
    // The kernel counts bytes. A user name in Japanese costs three bytes per character, so a path of 90
    // characters can be 200 bytes and still look short to `String.length`.
    const userData = `/Users/${"あ".repeat(40)}/pg`;
    expect(userData.length).toBeLessThan(MAX_UNIX_SOCKET_PATH);
    expect(Buffer.byteLength(userData)).toBeGreaterThan(MAX_UNIX_SOCKET_PATH);
    expect(
      chooseSocketPath({ userData, tmpDir: "/var/folders/tmp", filename }),
    ).toBe("/var/folders/tmp/pg-1234.sock");
  });

  it("accepts a path of exactly the limit and refuses one byte more", () => {
    const dir = "/tmp";
    const exact = "b".repeat(MAX_UNIX_SOCKET_PATH - dir.length - 1);
    expect(
      chooseSocketPath({ userData: dir, tmpDir: dir, filename: exact }),
    ).toHaveLength(MAX_UNIX_SOCKET_PATH);
    expect(() =>
      chooseSocketPath({ userData: dir, tmpDir: dir, filename: `${exact}c` }),
    ).toThrow(/no socket path fits/);
  });
});

describe("the engine binary path", () => {
  it("prefers an explicit override", () => {
    expect(
      resolveEnginePath({ projectRoot: "/p" }, {
        PHASEGRID_ENGINE_BIN: "/elsewhere/engine",
      } as NodeJS.ProcessEnv),
    ).toBe("/elsewhere/engine");
  });

  it("falls back to the development build", () => {
    expect(resolveEnginePath({ projectRoot: "/p" }, {})).toBe(
      "/p/build/engine/phasegrid-engine",
    );
  });
});

describe("engine supervisor", () => {
  it("spawns the engine in socket mode and announces the connection", async () => {
    const h = harness();
    await h.supervisor.start();

    // With a telemetry segment named for this process, so the renderer can map what the engine
    // writes without the two having to agree on a name after the fact.
    expect(h.args).toEqual([
      ["--socket", "/tmp/pg-test.sock", "--shm", `/pg-${process.pid}`],
    ]);
    expect(h.clients[0]?.calls).toEqual(["hello"]);
    expect(named(h.events, "engine.connected")).toEqual([
      { event: "engine.connected", seq: 1, data: { restarted: false } },
    ]);
    expect(h.supervisor.connected).toBe(true);
    expect(h.supervisor.engineInfo?.engineVersion).toBe("0.1.0-test");
  });

  it("retries the connection while the engine is still opening its device", async () => {
    const h = harness({ refusals: 3 });
    const started = h.supervisor.start();
    await vi.advanceTimersByTimeAsync(100);
    await started;

    expect(h.processes).toHaveLength(1); // it waited rather than spawning a second engine
    expect(named(h.events, "engine.connected")).toHaveLength(1);
  });

  it("does not restart after a clean exit", async () => {
    const h = harness();
    await h.supervisor.start();
    h.processes[0]?.exit(0);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(h.processes).toHaveLength(1);
    expect(named(h.events, "engine.connected")).toHaveLength(1);
    expect(h.supervisor.connected).toBe(false);
  });

  it("restarts after an unexpected exit and says the connection is a restart", async () => {
    const h = harness();
    await h.supervisor.start();
    h.processes[0]?.exit(null, "SIGKILL");
    await vi.advanceTimersByTimeAsync(250);

    expect(h.processes).toHaveLength(2);
    expect(named(h.events, "engine.connected").map((e) => e.data)).toEqual([
      { restarted: false },
      { restarted: true },
    ]);
  });

  it("doubles the delay between restarts (trap 7)", async () => {
    const h = harness();
    await h.supervisor.start();

    const delays: number[] = [];
    for (const expected of [250, 500, 1000]) {
      const before = h.processes.length;
      h.processes[before - 1]?.exit(139);
      // Nothing yet at one millisecond short of the delay; the next millisecond brings the restart.
      await vi.advanceTimersByTimeAsync(expected - 1);
      expect(h.processes).toHaveLength(before);
      await vi.advanceTimersByTimeAsync(1);
      expect(h.processes).toHaveLength(before + 1);
      delays.push(expected);
    }
    expect(delays).toEqual([250, 500, 1000]);
  });

  it("gives up after five failures inside the window (trap 7)", async () => {
    const h = harness();
    await h.supervisor.start();

    for (let i = 0; i < 5; i++) {
      h.processes[h.processes.length - 1]?.exit(139);
      await vi.advanceTimersByTimeAsync(10_000);
    }

    // Four restarts, then the fifth failure stops the loop instead of spawning a sixth engine.
    expect(h.processes).toHaveLength(5);
    expect(named(h.events, "engine.crashed")).toHaveLength(1);
    expect(named(h.events, "engine.crashed")[0]?.data).toMatchObject({
      message: expect.stringContaining("not restarting again"),
    });

    await vi.advanceTimersByTimeAsync(120_000);
    expect(h.processes).toHaveLength(5);
  });

  it("keeps restarting when the failures are spread beyond the window", async () => {
    const h = harness();
    await h.supervisor.start();

    for (let i = 0; i < 6; i++) {
      h.processes[h.processes.length - 1]?.exit(139);
      await vi.advanceTimersByTimeAsync(61_000); // each failure ages out before the next arrives
    }

    expect(h.processes).toHaveLength(7);
    expect(named(h.events, "engine.crashed")).toEqual([]);
  });

  it("forwards the engine's events under one continuous sequence", async () => {
    const h = harness();
    await h.supervisor.start();
    h.clients[0]?.say({
      event: "patch.revision",
      seq: 1,
      data: { revision: 4 },
    });
    h.processes[0]?.exit(null, "SIGKILL");
    await vi.advanceTimersByTimeAsync(250);
    // The restarted engine numbers its own events from 1 again; the renderer must not see that reset.
    h.clients[1]?.say({
      event: "patch.revision",
      seq: 1,
      data: { revision: 1 },
    });

    const revisions = named(h.events, "patch.revision");
    expect(revisions.map((e) => e.data)).toEqual([
      { revision: 4 },
      { revision: 1 },
    ]);
    expect(h.events.map((e) => e.seq)).toEqual(
      h.events.map((_e, i) => i + 1), // strictly monotonic across the restart
    );
  });

  it("turns the engine's output into log events", async () => {
    const h = harness();
    await h.supervisor.start();
    h.processes[0]?.say("error", "open failed: no device");

    expect(named(h.events, "engine.log").map((e) => e.data)).toContainEqual({
      level: "error",
      message: "open failed: no device",
    });
  });

  it("fails a call made while the engine is not running", async () => {
    const h = harness();
    await expect(h.supervisor.call("engine.ping", {})).rejects.toMatchObject({
      code: "E_IO",
    });

    await h.supervisor.start();
    await expect(h.supervisor.call("engine.ping", {})).resolves.toBeDefined();
  });

  it("stops without restarting, closing the socket so the engine exits (trap 3)", async () => {
    const h = harness();
    await h.supervisor.start();
    const engine = h.processes[0];
    // A real engine sees end of stream and exits; the fake does the same when its client closes.
    h.clients[0]?.onEvent(() => {});
    const stopped = h.supervisor.stop();
    engine?.exit(0);
    await stopped;

    expect(h.clients[0]?.closed).toBe(true);
    expect(engine?.signals).toEqual([]); // it went quietly; no kill was needed
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.processes).toHaveLength(1);
  });

  it("kills an engine that ignores the closed socket", async () => {
    const h = harness();
    await h.supervisor.start();
    const engine = h.processes[0];
    const stopped = h.supervisor.stop();
    await vi.advanceTimersByTimeAsync(2000);
    await stopped;

    expect(engine?.signals).toEqual(["SIGKILL"]);
  });

  it("rejects a first start that never connects, without entering the restart loop", async () => {
    const h = harness({ refusals: Number.POSITIVE_INFINITY });
    const started = h.supervisor.start();
    const failure = expect(started).rejects.toMatchObject({ code: "E_IO" });
    await vi.advanceTimersByTimeAsync(1000);
    await failure;

    expect(h.processes).toHaveLength(1);
    expect(h.processes[0]?.signals).toEqual(["SIGKILL"]); // and no orphan is left behind
  });
});

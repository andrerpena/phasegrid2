import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  CommandArgs,
  CommandName,
  CommandResult,
  EventData,
  EventName,
} from "../../../shared/protocol/commands";
import {
  type EventEnvelope,
  LineBuffer,
} from "../../../shared/protocol/envelope";
import {
  isCompatibleProtocol,
  PROTOCOL_VERSION,
} from "../../../shared/protocol/version";
import {
  type EngineClient,
  EngineError,
  EngineSocketClient,
} from "./socket-client";

/**
 * The engine's owner: it spawns the process, connects to it, restarts it when it dies, and is the single
 * place the rest of the application asks "what is the engine doing".
 *
 * Two traps shape it. Trap 1, the socket path: `sun_path` runs out at 104 bytes and `bind` truncates
 * silently rather than failing, so the path is measured and falls back to the temporary directory when
 * the user data directory would push it over. Trap 7, restart storms: a crash loop that restarts as fast
 * as it can will hold the audio device in a spin and fill the log with itself, so the delay doubles and
 * five failures inside a minute stop the loop with `engine.crashed`.
 *
 * Everything a test would need to fake is injected: how a process is spawned and how a client is made.
 * The tests therefore need no engine binary, no socket and no real time.
 */

/** `sun_path` is 104 bytes on macOS, including the terminator. Both sides check the same number. */
export const MAX_UNIX_SOCKET_PATH = 103;

export const ENGINE_BINARY_NAME = "phasegrid-engine";

/** Named in `hello` so an engine log can say which client is driving it. */
const CLIENT_NAME = "phasegrid2-electron";

/**
 * Where the engine's socket goes (trap 1).
 *
 * The natural home is the application's own data directory, but on macOS that is under
 * `~/Library/Application Support/<app>`, which with a long user name is already most of the budget --
 * and an over-long path does not fail loudly, it binds a socket at a truncated path that nobody can
 * connect to. So: measure it in BYTES, not characters, because a non-ASCII user name costs more than one
 * byte per character, and fall back to the temporary directory when it does not fit.
 */
export function chooseSocketPath(options: {
  userData: string;
  tmpDir: string;
  filename: string;
}): string {
  const preferred = join(options.userData, options.filename);
  if (Buffer.byteLength(preferred) <= MAX_UNIX_SOCKET_PATH) return preferred;
  const fallback = join(options.tmpDir, options.filename);
  if (Buffer.byteLength(fallback) <= MAX_UNIX_SOCKET_PATH) return fallback;
  throw new Error(
    `no socket path fits in ${MAX_UNIX_SOCKET_PATH} bytes: ` +
      `'${preferred}' is ${Buffer.byteLength(preferred)} and ` +
      `'${fallback}' is ${Buffer.byteLength(fallback)}`,
  );
}

/** One socket per process, so two instances of the application do not fight over one engine. */
export function defaultSocketFilename(pid: number = process.pid): string {
  return `pg-${pid}.sock`;
}

/** The engine binary: an explicit override, then the packaged copy, then the development build. */
export function resolveEnginePath(
  roots: { projectRoot: string; resourcesPath?: string },
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env.PHASEGRID_ENGINE_BIN;
  if (override) return override;
  if (roots.resourcesPath) {
    const packaged = join(roots.resourcesPath, "engine", ENGINE_BINARY_NAME);
    if (existsSync(packaged)) return packaged;
  }
  return join(roots.projectRoot, "build", "engine", ENGINE_BINARY_NAME);
}

export type LogLevel = EventData<"engine.log">["level"];

/**
 * The engine process, as the supervisor needs it. Deliberately smaller than `ChildProcess`: a test
 * implements this in a dozen lines, and the stream-to-lines work happens once, in the adapter below,
 * rather than in every test.
 */
export interface EngineProcessHandle {
  readonly pid: number | undefined;
  readonly exited: boolean;
  kill(signal?: NodeJS.Signals): void;
  /** Called immediately if the process has already gone, so a listener can never miss the exit. */
  onExit(
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): void;
  onLog(listener: (level: LogLevel, line: string) => void): void;
}

export type SpawnEngine = (
  binary: string,
  args: string[],
) => EngineProcessHandle;

/** The real thing: `child_process.spawn`, with its two output streams split into lines. */
export const spawnEngineProcess: SpawnEngine = (binary, args) => {
  const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
  const logListeners = new Set<(level: LogLevel, line: string) => void>();
  const exitListeners = new Set<
    (code: number | null, signal: NodeJS.Signals | null) => void
  >();
  let exited = false;
  let code: number | null = null;
  let signal: NodeJS.Signals | null = null;

  const pipe = (
    stream: NodeJS.ReadableStream | null,
    level: LogLevel,
  ): void => {
    if (stream === null) return;
    const frames = new LineBuffer();
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      for (const line of frames.push(chunk))
        for (const listener of [...logListeners]) listener(level, line);
    });
  };
  pipe(child.stdout, "info");
  pipe(child.stderr, "error");

  const finish = (
    exitCode: number | null,
    exitSignal: NodeJS.Signals | null,
  ): void => {
    if (exited) return;
    exited = true;
    code = exitCode;
    signal = exitSignal;
    for (const listener of [...exitListeners]) listener(code, signal);
  };
  child.on("exit", finish);
  // A binary that does not exist reports `error` and may never report `exit`. Treat it as an exit, or the
  // supervisor would wait forever for a process that was never born.
  child.on("error", (error) => {
    for (const listener of [...logListeners]) listener("error", error.message);
    finish(null, null);
  });

  return {
    get pid() {
      return child.pid;
    },
    get exited() {
      return exited;
    },
    kill(sig = "SIGTERM") {
      child.kill(sig);
    },
    onExit(listener) {
      if (exited) listener(code, signal);
      else exitListeners.add(listener);
    },
    onLog(listener) {
      logListeners.add(listener);
    },
  };
};

export interface SupervisorOptions {
  enginePath: string;
  socketPath: string;
  /**
   * The shared-memory segment the engine publishes telemetry into. Named for this process rather
   * than the engine's, so it is known before the engine exists and survives a restart unchanged: the
   * engine unlinks whatever a previous life left at the name before creating its own.
   */
  shmName?: string;
  /**
   * The audio device the engine opens: a device id, or `null` for the silent backend. Absent means
   * the system default. Passed straight through as `--device`; the engine is the one that knows what
   * the ids mean.
   */
  device?: string;
  /** Injected in tests. */
  spawnEngine?: SpawnEngine;
  createClient?: (socketPath: string) => EngineClient;
  /** The engine has to open the audio device before it binds, so the first connects will fail. */
  connectAttempts?: number;
  connectDelayMs?: number;
  /** Trap 7. */
  backoffMs?: number;
  maxBackoffMs?: number;
  crashFailures?: number;
  crashWindowMs?: number;
  /** How long a deliberate stop waits for the engine to notice the closed socket before killing it. */
  shutdownGraceMs?: number;
  now?: () => number;
}

export type SupervisorEventListener = (event: EventEnvelope) => void;

export class EngineSupervisor {
  private readonly options: Required<SupervisorOptions>;
  private child: EngineProcessHandle | null = null;
  private client: EngineClient | null = null;
  private handshake: CommandResult<"hello"> | null = null;
  /**
   * Which launch is the current one. Every exit carries the generation it belongs to, so the death rattle
   * of a process we already gave up on cannot be mistaken for a fresh crash and counted twice.
   */
  private generation = 0;
  private stopping = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  /** When each unexpected exit happened, pruned to the crash window. */
  private failures: number[] = [];
  private readonly listeners = new Set<SupervisorEventListener>();
  /**
   * One monotonic sequence for everything the renderer sees. The engine numbers its own events per
   * connection and starts again at 1 after a restart, which would look like a reordering to anyone
   * downstream, so the supervisor renumbers as it forwards.
   */
  private seq = 0;

  constructor(options: SupervisorOptions) {
    this.options = {
      shmName: `/pg-${process.pid}`,
      device: "",
      spawnEngine: spawnEngineProcess,
      createClient: (path) => new EngineSocketClient(path),
      connectAttempts: 200,
      connectDelayMs: 50,
      backoffMs: 250,
      maxBackoffMs: 8000,
      crashFailures: 5,
      crashWindowMs: 60_000,
      shutdownGraceMs: 2000,
      now: Date.now,
      ...options,
    };
  }

  get connected(): boolean {
    return this.client !== null;
  }

  /** What `hello` answered on the current connection, or null while there is none. */
  get engineInfo(): CommandResult<"hello"> | null {
    return this.handshake;
  }

  onEvent(listener: SupervisorEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * The first launch. It rejects rather than retrying: an engine that cannot start even once is a broken
   * install or a wrong path, and a restart loop over that would hide the real error behind a scroll of
   * identical failures. The restart machinery covers the case it is for -- a process that was running and
   * then died.
   */
  async start(): Promise<void> {
    this.stopping = false;
    try {
      await this.launch(false);
    } catch (error) {
      this.abandonChild();
      throw error;
    }
  }

  call<C extends CommandName>(
    cmd: C,
    args: CommandArgs<C>,
  ): Promise<CommandResult<C>> {
    const client = this.client;
    if (client === null)
      return Promise.reject(
        new EngineError("E_IO", `${cmd}: the engine is not running`),
      );
    return client.call(cmd, args);
  }

  /**
   * A deliberate stop. Closing the socket is the shutdown signal (trap 3): the engine treats end of
   * stream as "my client is gone" and exits, releasing the audio device. The kill is only the backstop
   * for an engine that is wedged, because an orphan holding the device outlives the application.
   */
  async stop(): Promise<void> {
    this.stopping = true;
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    const child = this.child;
    this.client?.close();
    this.client = null;
    this.handshake = null;
    if (child === null) return;
    if (!child.exited) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, this.options.shutdownGraceMs);
        child.onExit(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    this.child = null;
  }

  private async launch(restarted: boolean): Promise<void> {
    const generation = ++this.generation;
    const child = this.options.spawnEngine(this.options.enginePath, [
      "--socket",
      this.options.socketPath,
      "--shm",
      this.options.shmName,
      ...(this.options.device === "" ? [] : ["--device", this.options.device]),
    ]);
    this.child = child;
    child.onLog((level, message) =>
      this.emit("engine.log", { level, message }),
    );
    child.onExit((code, signal) => this.handleExit(generation, code, signal));

    const client = this.options.createClient(this.options.socketPath);
    await this.connectWithRetry(client, child, generation);
    if (generation !== this.generation) {
      client.close();
      throw new EngineError("E_IO", "this launch was superseded");
    }
    this.client = client;
    client.onEvent((event) => this.emit(event.event, event.data));

    const hello = await client.call("hello", {
      protocolVersion: PROTOCOL_VERSION,
      client: CLIENT_NAME,
    });
    // A version mismatch is not something a restart fixes, so it is thrown rather than counted as a
    // failure: the caller sees it, or `relaunch` turns it into `engine.crashed` and stops.
    if (!isCompatibleProtocol(hello.protocolVersion))
      throw new EngineError(
        "E_VERSION",
        `the engine speaks protocol ${hello.protocolVersion} and this build speaks ${PROTOCOL_VERSION}`,
      );
    this.handshake = hello;
    this.emit("engine.connected", { restarted });
  }

  private async connectWithRetry(
    client: EngineClient,
    child: EngineProcessHandle,
    generation: number,
  ): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      // The engine binds its socket only after the audio device opens, so the first attempts find
      // nothing there. A process that has already died, though, is never going to bind.
      if (child.exited)
        throw new EngineError(
          "E_IO",
          "the engine exited before it accepted a connection",
        );
      if (generation !== this.generation)
        throw new EngineError("E_IO", "this launch was superseded");
      try {
        await client.connect();
        return;
      } catch (error) {
        if (attempt >= this.options.connectAttempts) throw error;
        await this.sleep(this.options.connectDelayMs);
      }
    }
  }

  private handleExit(
    generation: number,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (generation !== this.generation) return; // a process we already abandoned, finally dying
    this.child = null;
    // The client is the only thing holding the pending calls, and they can never be answered now.
    this.client?.close();
    this.client = null;
    this.handshake = null;
    if (this.stopping) return;

    const how = signal !== null ? `signal ${signal}` : `code ${code}`;
    this.emit("engine.log", {
      level: "warn",
      message: `the engine exited with ${how}`,
    });
    // A clean exit is the engine doing what it was told -- `engine.shutdown`, or the socket we closed.
    // Restarting it would be arguing with a decision that was ours.
    if (code === 0 && signal === null) return;
    this.noteFailure(`the engine exited with ${how}`);
  }

  /** Trap 7: back off, and give up rather than loop forever. */
  private noteFailure(why: string): void {
    if (this.stopping) return;
    const at = this.options.now();
    this.failures.push(at);
    this.failures = this.failures.filter(
      (when) => at - when < this.options.crashWindowMs,
    );
    if (this.failures.length >= this.options.crashFailures) {
      this.stopping = true; // nothing restarts after this; `start` is the way back
      this.emit("engine.crashed", {
        message: `${why}. ${this.failures.length} failures within ${Math.round(
          this.options.crashWindowMs / 1000,
        )} seconds; not restarting again.`,
      });
      return;
    }
    // The delay grows with how many failures are still inside the window, not with how many connects in
    // a row went wrong: an engine that connects happily and then dies a second later is the restart storm
    // this exists for, and it would otherwise reset the delay on every successful handshake. Ageing out of
    // the window is what resets it, which is the same rule the crash threshold uses.
    const delay = Math.min(
      this.options.maxBackoffMs,
      this.options.backoffMs * 2 ** (this.failures.length - 1),
    );
    this.emit("engine.log", {
      level: "warn",
      message: `restarting the engine in ${delay} ms`,
    });
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void this.relaunch();
    }, delay);
  }

  private async relaunch(): Promise<void> {
    try {
      await this.launch(true);
    } catch (error) {
      // The process may still be alive and holding the audio device even though we could not talk to it.
      this.abandonChild();
      this.noteFailure(messageOf(error));
    }
  }

  /**
   * Give up on the current process: stop listening to it, and make sure it is dead. Bumping the
   * generation is what stops its eventual exit from being counted as a second failure.
   */
  private abandonChild(): void {
    this.generation++;
    const child = this.child;
    this.child = null;
    this.client?.close();
    this.client = null;
    this.handshake = null;
    if (child !== null && !child.exited) child.kill("SIGKILL");
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private emit<E extends EventName>(event: E, data: EventData<E>): void;
  private emit(event: string, data: unknown): void;
  private emit(event: string, data: unknown): void {
    const envelope: EventEnvelope = { event, seq: ++this.seq, data };
    for (const listener of [...this.listeners]) listener(envelope);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

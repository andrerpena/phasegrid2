import { connect, type Socket } from "node:net";
import {
  COMMANDS,
  type CommandArgs,
  type CommandName,
  type CommandResult,
  isCommandName,
} from "../../../shared/protocol/commands";
import {
  type EventEnvelope,
  EventEnvelopeSchema,
  encodeLine,
  LineBuffer,
  ResponseSchema,
} from "../../../shared/protocol/envelope";

/**
 * The Electron half of the protocol: a Unix socket, newline-delimited JSON, and a pending map that turns
 * every line the engine writes back into the promise that was waiting for it.
 *
 * Two things it does that a naive version does not, both of which cost a debugging session to find:
 *
 *  - Framing goes through `LineBuffer` (trap 2). A socket read has nothing to do with message
 *    boundaries; it can split a message mid-token or deliver three at once. There is exactly one
 *    implementation of that rule, in `shared/protocol/envelope.ts`, and both this client and the CLI
 *    use it rather than each keeping a private copy that drifts.
 *  - Every pending call is rejected when the connection drops (trap 4). A promise that can never settle
 *    is worse than an error: the interface waits on it forever with no way to say what went wrong.
 */

/** An error the engine reported, or one this client raised in the engine's vocabulary. */
export class EngineError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "EngineError";
    this.code = code;
  }

  /** `E_SCHEMA: module.add: ...`, which is what a log line or a CLI wants. */
  override toString(): string {
    return `${this.code}: ${this.message}`;
  }
}

export type EngineEventListener = (event: EventEnvelope) => void;

/** What the supervisor needs from a connection. A test substitutes something far smaller. */
export interface EngineClient {
  connect(): Promise<void>;
  call<C extends CommandName>(
    cmd: C,
    args: CommandArgs<C>,
  ): Promise<CommandResult<C>>;
  onEvent(listener: EngineEventListener): () => void;
  close(): void;
  readonly connected: boolean;
}

interface PendingCall {
  cmd: string;
  resolve: (value: unknown) => void;
  reject: (reason: EngineError) => void;
}

/**
 * The `seq` on an event this client made up rather than received. The engine numbers its own events from
 * 1, so zero is unambiguous: it means "the connection is telling you something", not "the engine said".
 */
const LOCAL_EVENT_SEQ = 0;

function truncate(line: string): string {
  return line.length <= 120 ? line : `${line.slice(0, 117)}...`;
}

export class EngineSocketClient implements EngineClient {
  private socket: Socket | null = null;
  private open = false;
  private nextId = 1;
  private readonly frames = new LineBuffer();
  private readonly pending = new Map<number, PendingCall>();
  private readonly listeners = new Set<EngineEventListener>();

  constructor(private readonly path: string) {}

  get connected(): boolean {
    return this.open;
  }

  connect(): Promise<void> {
    if (this.socket !== null)
      return Promise.reject(
        new EngineError("E_IO", "this client is already connected"),
      );
    return new Promise<void>((resolve, reject) => {
      const socket = connect(this.path);
      this.socket = socket;
      socket.setEncoding("utf8");

      // Until the connection is up, a failure belongs to `connect`'s promise: the engine may not have
      // bound its socket yet, and the supervisor's retry loop is the thing that should hear about it.
      const failConnect = (error: Error): void => {
        socket.destroy();
        if (this.socket === socket) this.socket = null;
        reject(new EngineError("E_IO", `${this.path}: ${error.message}`));
      };
      socket.once("error", failConnect);
      socket.once("connect", () => {
        socket.off("error", failConnect);
        this.open = true;
        this.frames.reset();
        socket.on("data", (chunk: string) => this.receive(chunk));
        // From here on a failure belongs to the calls in flight, not to a connect that already resolved.
        socket.on("error", (error: Error) => this.drop(error.message));
        socket.on("close", () => this.drop("the engine closed the connection"));
        resolve();
      });
    });
  }

  call<C extends CommandName>(
    cmd: C,
    args: CommandArgs<C>,
  ): Promise<CommandResult<C>> {
    const socket = this.socket;
    // Fail now rather than queue silently: a caller that cannot tell "not connected" from "slow" will
    // hang its own interface waiting for an engine that is not there.
    if (!this.open || socket === null)
      return Promise.reject(
        new EngineError("E_IO", `${cmd}: the engine is not connected`),
      );

    const id = this.nextId++;
    return new Promise<CommandResult<C>>((resolve, reject) => {
      this.pending.set(id, {
        cmd,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      socket.write(encodeLine({ id, cmd, args }), (error) => {
        if (!error || !this.pending.delete(id)) return;
        reject(new EngineError("E_IO", `${cmd}: ${error.message}`));
      });
    });
  }

  onEvent(listener: EngineEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  close(): void {
    this.drop("the engine client was closed");
  }

  /** Trap 4: nothing may stay pending once the bytes stop flowing. */
  private drop(why: string): void {
    const socket = this.socket;
    if (socket === null) return; // a socket reports both `error` and `close`; the first one wins
    this.socket = null;
    this.open = false;
    socket.destroy();
    const waiting = [...this.pending.values()];
    this.pending.clear();
    this.frames.reset();
    for (const call of waiting)
      call.reject(new EngineError("E_IO", `${call.cmd}: ${why}`));
  }

  private receive(chunk: string): void {
    for (const line of this.frames.push(chunk)) this.receiveLine(line);
  }

  private receiveLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      this.report("E_SCHEMA", `not JSON: ${truncate(line)}`);
      return;
    }

    const asEvent = EventEnvelopeSchema.safeParse(message);
    if (asEvent.success) {
      // A copy, so a listener that unsubscribes itself does not disturb the walk.
      for (const listener of [...this.listeners]) listener(asEvent.data);
      return;
    }

    const asResponse = ResponseSchema.safeParse(message);
    if (!asResponse.success) {
      this.report(
        "E_SCHEMA",
        `neither a response nor an event: ${truncate(line)}`,
      );
      return;
    }
    const response = asResponse.data;
    const id = typeof response.id === "number" ? response.id : null;
    const call = id === null ? undefined : this.pending.get(id);
    if (call === undefined) {
      // An error with a null id is the engine answering a line it could not even read an id from.
      const detail = response.ok ? "" : `: ${response.error.message}`;
      this.report(
        "E_SCHEMA",
        `no call is waiting for id ${JSON.stringify(response.id)}${detail}`,
      );
      return;
    }
    this.pending.delete(id as number);

    if (!response.ok) {
      call.reject(new EngineError(response.error.code, response.error.message));
      return;
    }
    const def = isCommandName(call.cmd) ? COMMANDS[call.cmd] : null;
    if (def === null) {
      call.resolve(response.result);
      return;
    }
    // The command table is the agreement, and a result that does not match it is a real disagreement
    // between the two sides rather than version skew -- unknown keys are stripped, not rejected.
    const parsed = def.result.safeParse(response.result);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue?.path.join(".") ?? "";
      call.reject(
        new EngineError(
          "E_SCHEMA",
          `${call.cmd}: the engine's result does not match the protocol${where ? ` at ${where}` : ""}: ${issue?.message ?? "unparseable"}`,
        ),
      );
      return;
    }
    call.resolve(parsed.data);
  }

  /** Something arrived that no call can be blamed for. Say so on the event channel instead of throwing. */
  private report(code: string, message: string): void {
    const envelope: EventEnvelope = {
      event: "engine.error",
      seq: LOCAL_EVENT_SEQ,
      data: { code, message },
    };
    for (const listener of [...this.listeners]) listener(envelope);
  }
}

import { useEngineStore } from "@renderer/engine/engine-store";
import type { EventEnvelope } from "@shared/protocol/envelope";
import { create } from "zustand";

/**
 * What the engine and the application have said, kept where something can read it.
 *
 * The engine's output used to arrive as `engine.log` events and go nowhere: the Log panel was a
 * stub, and an engine that printed a reason for a failure printed it into the void. This is the
 * one place it lands. The panel lists it, `pg.log` reads it, and every entry is echoed to the
 * console so a debugger attached to the window sees engine output without asking for it.
 *
 * Bounded, because a session that runs for a day should not grow without limit and nobody scrolls
 * back past a few hundred lines.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogSource = "engine" | "renderer" | "app";

export interface LogEntry {
  /** `Date.now()` when it was recorded. */
  time: number;
  level: LogLevel;
  source: LogSource;
  message: string;
}

export interface LogState {
  entries: LogEntry[];
  limit: number;
}

export interface LogActions {
  push: (entry: Omit<LogEntry, "time"> & { time?: number }) => void;
  clear: () => void;
  /** The last `n` entries, oldest first. */
  tail: (n: number) => LogEntry[];
}

export const useLogStore = create<LogState & LogActions>((set, get) => ({
  entries: [],
  limit: 500,

  push: (entry) => {
    const next = [...get().entries, { time: Date.now(), ...entry }];
    if (next.length > get().limit) next.splice(0, next.length - get().limit);
    set({ entries: next });
  },

  clear: () => set({ entries: [] }),

  tail: (n) => get().entries.slice(Math.max(0, get().entries.length - n)),
}));

/**
 * An engine event as a log line, or null for the ones that are not worth one.
 *
 * Pure, so the mapping is tested without a window. Position is left out: it arrives twenty times a
 * second and would be the whole log.
 */
export function entryForEvent(
  event: EventEnvelope,
): Omit<LogEntry, "time"> | null {
  const data = (event.data ?? {}) as Record<string, unknown>;
  const message = typeof data.message === "string" ? data.message : "";
  switch (event.event) {
    case "engine.log": {
      const level = data.level;
      return {
        level: isLevel(level) ? level : "info",
        source: "engine",
        message,
      };
    }
    case "engine.error":
      return {
        level: "error",
        source: "engine",
        message: `${typeof data.code === "string" ? `${data.code}: ` : ""}${message}`,
      };
    case "engine.crashed":
      return { level: "error", source: "engine", message };
    case "engine.connected":
      return {
        level: "info",
        source: "app",
        message: data.restarted
          ? "reconnected to a restarted engine"
          : "connected to the engine",
      };
    default:
      return null;
  }
}

function isLevel(value: unknown): value is LogLevel {
  return (
    value === "debug" ||
    value === "info" ||
    value === "warn" ||
    value === "error"
  );
}

/** Records an entry and says it aloud. `console` is what a debugger attached to the window sees. */
export function record(entry: Omit<LogEntry, "time">): void {
  useLogStore.getState().push(entry);
  const line = `[${entry.source}] ${entry.message}`;
  if (entry.level === "error") console.error(line);
  else if (entry.level === "warn") console.warn(line);
  else console.log(line);
}

/**
 * Wires the store to the world: engine events, the engine store's own view of the handshake, and
 * the renderer's uncaught errors, which are otherwise only visible in a developer console nobody
 * has open.
 *
 * The handshake comes from the store rather than from the `engine.ready` event, because that event
 * is sent while the window is still loading and nothing is listening yet; the store's status is
 * what the renderer actually learned, whenever it learned it.
 */
export function watchLog(): () => void {
  const stopEvents = window.engine.onEvent((event) => {
    const entry = entryForEvent(event);
    if (entry !== null) record(entry);
  });
  const stopStatus = useEngineStore.subscribe((state, previous) => {
    if (state.status === previous.status && state.detail === previous.detail)
      return;
    if (state.status === "ready")
      record({
        level: "info",
        source: "engine",
        message: `${state.detail} ready`,
      });
    else if (state.status === "error")
      record({ level: "error", source: "engine", message: state.detail });
  });
  const onError = (event: ErrorEvent): void => {
    record({
      level: "error",
      source: "renderer",
      message: event.message,
    });
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    const reason = event.reason as { message?: unknown } | undefined;
    record({
      level: "error",
      source: "renderer",
      message: `unhandled rejection: ${typeof reason?.message === "string" ? reason.message : String(event.reason)}`,
    });
  };
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    stopEvents();
    stopStatus();
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}

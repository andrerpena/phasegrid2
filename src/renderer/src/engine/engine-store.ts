import type {
  CommandArgs,
  CommandName,
  CommandResult,
  HelloResultSchema,
} from "@shared/protocol/commands";
import type { z } from "zod";
import { create } from "zustand";

/**
 * The engine, as the interface sees it: is it there, and what did it last say.
 *
 * Everything that talks to the engine goes through here rather than calling the bridge directly, so
 * there is one place that knows whether a call can succeed and one place that hears about a restart.
 */

export type EngineStatus = "connecting" | "ready" | "error";

interface EngineState {
  status: EngineStatus;
  /** A sentence for the status bar. */
  detail: string;
  engineVersion: string | null;
  catalogHash: string | null;
  /** The telemetry segment this engine writes, or null when it has none. Mapped by the grid. */
  shm: z.infer<typeof HelloResultSchema>["shm"];
  /** What this engine can do, by name. Absence is the answer to "can it?", never an error. */
  capabilities: string[];
  /**
   * Whether the patch is advancing. False is Stop: no sound, and nothing moving on the canvas
   * either, because nothing is running to move it. Kept here rather than in the header that sets it,
   * since the canvas has to know too.
   */
  running: boolean;
  revision: number;
}

interface EngineActions {
  connect: () => Promise<void>;
  /** Runs or holds the patch, and records which, so everything drawing from it agrees. */
  setRunning: (running: boolean) => Promise<void>;
  call: <C extends CommandName>(
    cmd: C,
    args: CommandArgs<C>,
  ) => Promise<CommandResult<C>>;
}

export const useEngineStore = create<EngineState & EngineActions>(
  (set, get) => ({
    status: "connecting",
    detail: "connecting to the engine",
    engineVersion: null,
    catalogHash: null,
    shm: null,
    capabilities: [],
    running: true,
    revision: 0,

    connect: async () => {
      try {
        const hello = await window.engine.call("hello", {
          protocolVersion: 1,
          client: "phasegrid2",
        });
        set({
          status: "ready",
          detail: `engine ${hello.engineVersion}`,
          engineVersion: hello.engineVersion,
          catalogHash: hello.catalogHash,
          shm: hello.shm,
          capabilities: hello.capabilities,
        });
      } catch (error) {
        set({ status: "error", detail: (error as Error).message });
      }
    },

    setRunning: async (running) => {
      // Recorded first: what the interface draws follows the button, and a failed call leaves an
      // engine that is not running anyway.
      set({ running });
      await get()
        .call("audio.setRunning", { running })
        .catch(() => {});
    },

    call: async (cmd, args) => {
      try {
        return await window.engine.call(cmd, args);
      } catch (error) {
        // Surfaced in the status bar rather than swallowed: a command that silently does nothing is the
        // hardest kind of failure to notice.
        set({ status: "error", detail: `${cmd}: ${(error as Error).message}` });
        throw error;
      }
    },
  }),
);

/** Subscribes to engine events. Called once, at startup. */
export function watchEngine(): () => void {
  return window.engine.onEvent((event) => {
    if (event.event === "engine.ready") {
      // A restart re-runs the handshake: the engine that just came up is a different process with its
      // own version and catalog, and assuming otherwise is how a stale catalog gets drawn.
      void useEngineStore.getState().connect();
    }
    if (event.event === "engine.error") {
      const data = event.data as { message?: string };
      useEngineStore.setState({
        status: "error",
        detail: data.message ?? "engine error",
      });
    }
    if (event.event === "patch.revision") {
      const data = event.data as { revision?: number };
      if (typeof data.revision === "number")
        useEngineStore.setState({ revision: data.revision });
    }
  });
}

import type {
  CommandArgs,
  CommandName,
  CommandResult,
} from "@shared/protocol/commands";
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
  revision: number;
}

interface EngineActions {
  connect: () => Promise<void>;
  call: <C extends CommandName>(
    cmd: C,
    args: CommandArgs<C>,
  ) => Promise<CommandResult<C>>;
}

export const useEngineStore = create<EngineState & EngineActions>((set) => ({
  status: "connecting",
  detail: "connecting to the engine",
  engineVersion: null,
  catalogHash: null,
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
      });
    } catch (error) {
      set({ status: "error", detail: (error as Error).message });
    }
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
}));

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

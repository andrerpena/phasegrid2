import { useEngineStore } from "@renderer/engine/engine-store";
import type { EventEnvelope } from "@shared/protocol/envelope";
import { create } from "zustand";

/**
 * Whether the piece is playing.
 *
 * One fact, in one place, because three things need it: the header's button shows it, the canvas
 * asks it to know whether the knobs it draws are live, and a command or a script has to be able to
 * flip it by name rather than by finding a button. It lived inside the header as component state,
 * which was fine until anything but the header wanted to know.
 *
 * Playing is three things on the engine, sent together: the clock rolls, the patch runs, and the
 * output is open. Holding the patch is what actually stops it -- a modular is not gated by its
 * clock, so stopping the transport alone leaves an oscillator droning, and silencing the output
 * alone leaves it droning unheard while every modulated knob on the canvas goes on turning. The
 * gain stays in the gesture as the plain guarantee of silence.
 */

export interface TransportState {
  playing: boolean;
}

export interface TransportActions {
  play: () => void;
  stop: () => void;
  toggle: () => void;
}

/** The three calls that make the engine agree with the button. */
function push(playing: boolean): void {
  const engine = useEngineStore.getState();
  void engine
    .call(playing ? "transport.play" : "transport.stop", {})
    .catch(() => {});
  void engine.setRunning(playing);
  void engine
    .call("audio.setOutputGain", { gain: playing ? 1 : 0 })
    .catch(() => {});
}

export const useTransportStore = create<TransportState & TransportActions>(
  (set, get) => ({
    playing: false,

    play: () => {
      set({ playing: true });
      push(true);
    },
    stop: () => {
      set({ playing: false });
      push(false);
    },
    toggle: () => (get().playing ? get().stop() : get().play()),
  }),
);

/**
 * Keeps the engine and the store agreeing across the moments they could drift.
 *
 * The engine is told the current state at startup and again whenever it comes up, because a fresh
 * engine starts with its output open while the button says Play -- and a project would make sound
 * before anyone asked, with the control that is supposed to start it appearing to do nothing. And
 * the store follows the engine's own `playing` off the position events, so what the button shows
 * is what the clock is doing rather than what was last asked of it.
 *
 * `onEvent` is injectable so this can be exercised without a window.
 */
export function watchTransport(
  onEvent: (listener: (event: EventEnvelope) => void) => () => void = (l) =>
    window.engine.onEvent(l),
): () => void {
  push(useTransportStore.getState().playing);
  return onEvent((event) => {
    if (event.event === "engine.ready") {
      push(useTransportStore.getState().playing);
      return;
    }
    if (event.event === "transport.position") {
      const data = event.data as { playing?: unknown };
      if (
        typeof data.playing === "boolean" &&
        data.playing !== useTransportStore.getState().playing
      )
        useTransportStore.setState({ playing: data.playing });
    }
  });
}

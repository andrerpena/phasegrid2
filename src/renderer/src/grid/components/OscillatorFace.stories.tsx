import { hexToNumber } from "@renderer/lib/color";
import { useThemeStore } from "@renderer/theming/theme-store";
import type { ModuleDescriptor } from "@shared/protocol/catalog";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Container } from "pixi.js";
import { useCallback } from "react";
import { descriptor } from "../fixtures";
import { measureNode } from "../layout";
import { PixiStage } from "../stories/PixiStage";
import { faceStyle, OscillatorFace } from "./OscillatorFace";

/**
 * The face every module that plays a wave wears: the wave on the left, its knobs on the right.
 *
 * The layouts here come from real catalogue descriptors through the same `measureNode` the grid
 * uses, so what a story shows is what the patch will draw. The waves are made up on the spot; in the
 * application they come from the engine.
 */
const meta: Meta = {
  title: "Grid/OscillatorFace",
  parameters: { layout: "centered" },
};
export default meta;

const N = 256;
const cycle = (f: (phase: number) => number) =>
  Float32Array.from({ length: N }, (_, i) => f(i / N));
const SINE = cycle((p) => -Math.cos(2 * Math.PI * p));
const SAW = cycle((p) => 2 * p - 1);
const SQUARE = cycle((p) => (p < 0.5 ? 1 : -1));

/** A pulse with the Width knob it is going to grow: two knobs beside the wave. */
const PULSE_WITH_WIDTH: ModuleDescriptor = (() => {
  const pulse = descriptor("osc.pulse");
  const sync = pulse.params[0];
  return {
    ...pulse,
    params: [sync, { ...sync, id: "width", name: "Width", unit: "ratio" }],
  };
})();

interface FaceArgs {
  module: ModuleDescriptor;
  wave: ArrayLike<number>;
  values: Record<string, number>;
  /** Animate this knob as if an LFO were on it. */
  liveParam?: string;
}

const FaceStage = ({ module, wave, values, liveParam }: FaceArgs) => {
  const theme = useThemeStore((s) => s.theme);
  const build = useCallback(
    (app: {
      ticker: {
        add: (fn: () => void) => void;
        remove: (fn: () => void) => void;
      };
    }) => {
      const layout = measureNode(module);
      if (layout.display === null)
        throw new Error("no wave panel on this module");
      const view = new Container();
      const face = new OscillatorFace(
        layout.display,
        layout.controls,
        faceStyle(theme.grid, hexToNumber(theme.grid.signal.audio)),
      );
      face.setWave(wave);
      for (const [id, fraction] of Object.entries(values))
        face.setValue(id, fraction);
      view.addChild(face.view);
      view.position.set(0, 12);

      // The modulated knob turns on its own, the way it does with an LFO plugged into it.
      const start = performance.now();
      const tick = () => {
        if (liveParam === undefined) return;
        const t = (performance.now() - start) / 1000;
        const base = values[liveParam] ?? 0.5;
        face.setLive(
          liveParam,
          Math.max(0, Math.min(1, base + 0.3 * Math.sin(t * 2))),
        );
      };
      app.ticker.add(tick);
      return {
        view,
        destroy: () => {
          app.ticker.remove(tick);
          face.destroy();
        },
      };
    },
    [module, wave, values, liveParam, theme],
  );
  const layout = measureNode(module);
  return (
    <PixiStage build={build} width={layout.width} height={layout.height} />
  );
};

/** The sine: wave plus one knob, the smallest face there is. */
export const OneKnob: StoryObj<FaceArgs> = {
  args: { module: descriptor("osc.sine"), wave: SINE, values: { fold: 0.25 } },
  render: (args) => <FaceStage {...args} />,
};

/** A pulse that has grown a Width knob: the face gets wider, nothing else changes. */
export const TwoKnobs: StoryObj<FaceArgs> = {
  args: {
    module: PULSE_WITH_WIDTH,
    wave: SQUARE,
    values: { sync: 0.1, width: 0.5 },
  },
  render: (args) => <FaceStage {...args} />,
};

/** The LFO: Rate, Shape and Depth beside its wave. */
export const ThreeKnobs: StoryObj<FaceArgs> = {
  args: {
    module: descriptor("mod.lfo"),
    wave: SAW,
    values: { rate: 0.5, shape: 0.66, depth: 1 },
  },
  render: (args) => <FaceStage {...args} />,
};

/** An LFO on the sawtooth's Sync: the knob turns, and the notch says where it is set. */
export const Modulated: StoryObj<FaceArgs> = {
  args: {
    module: descriptor("osc.sawtooth"),
    wave: SAW,
    values: { sync: 0.5 },
    liveParam: "sync",
  },
  render: (args) => <FaceStage {...args} />,
};

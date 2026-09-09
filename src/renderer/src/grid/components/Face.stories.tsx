import { hexToNumber } from "@renderer/lib/color";
import { useThemeStore } from "@renderer/theming/theme-store";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Container } from "pixi.js";
import { useCallback } from "react";
import { composeFace } from "../face";
import { CATALOG, descriptor, moduleNode } from "../fixtures";
import { PixiStage } from "../stories/PixiStage";
import { NodeView } from "./NodeView";

/**
 * Whole modules, as the patch draws them, from the catalogue the engine printed.
 *
 * A face is the blocks the engine declared for the module, or the ones composed for it when it
 * declared none, so what a story shows is what the canvas will draw. The wave is made up on the
 * spot; in the application it comes from the engine.
 */
const meta: Meta = {
  title: "Grid/Face",
  parameters: { layout: "centered" },
};
export default meta;

const N = 256;
const cycle = (f: (phase: number) => number) =>
  Float32Array.from({ length: N }, (_, i) => f(i / N));
const WAVES: Record<string, ArrayLike<number>> = {
  "osc.sine": cycle((p) => -Math.cos(2 * Math.PI * p)),
  "osc.sawtooth": cycle((p) => 2 * p - 1),
  "osc.pulse": cycle((p) => (p < 0.5 ? 1 : -1)),
  "mod.lfo": cycle((p) => (p < 0.5 ? 4 * p - 1 : 3 - 4 * p)),
};

interface Args {
  moduleId: string;
  /** Parameter values, 0..1 of each range. */
  values: Record<string, number>;
  /** Animate this knob as if an LFO were on it. */
  liveParam?: string;
}

const FaceStage = ({ moduleId, values, liveParam }: Args) => {
  const theme = useThemeStore((s) => s.theme);
  const module = descriptor(moduleId);
  const face = composeFace(module);
  const build = useCallback(
    (app: {
      ticker: {
        add: (fn: () => void) => void;
        remove: (fn: () => void) => void;
      };
    }) => {
      const params: Record<string, number> = {};
      for (const [id, fraction] of Object.entries(values)) {
        const param = module.params.find((p) => p.id === id);
        if (param !== undefined)
          params[id] = param.min + fraction * (param.max - param.min);
      }
      const node = new NodeView(
        moduleNode("story", module.id, { x: 12, y: 12, params }),
        module,
        {
          colors: theme.grid,
          accent: hexToNumber(theme.grid.signal.audio),
        },
      );
      const wave = WAVES[module.id];
      if (wave !== undefined) node.setWave(wave);
      const view = new Container();
      view.addChild(node.view);

      // The modulated knob turns on its own, the way it does with an LFO plugged into it.
      const start = performance.now();
      const tick = () => {
        if (liveParam === undefined) return;
        const t = (performance.now() - start) / 1000;
        const base = values[liveParam] ?? 0.5;
        node.setLive(
          liveParam,
          Math.max(0, Math.min(1, base + 0.3 * Math.sin(t * 2))),
        );
      };
      app.ticker.add(tick);
      return {
        view,
        destroy: () => {
          app.ticker.remove(tick);
          node.destroy();
        },
      };
    },
    [module, values, liveParam, theme],
  );
  return (
    <PixiStage
      build={build}
      width={face.width + 24}
      height={face.height + 24}
    />
  );
};

/** The sine: three jacks, its wave, one knob, the output. The smallest declared face there is. */
export const Sine: StoryObj<Args> = {
  args: { moduleId: "osc.sine", values: { fold: 0.25 } },
  render: (args) => <FaceStage {...args} />,
};

/** The LFO: Reset, its wave, then Rate, Shape and Depth in a row, and the output. */
export const Lfo: StoryObj<Args> = {
  args: { moduleId: "mod.lfo", values: { rate: 0.5, shape: 0.66, depth: 1 } },
  render: (args) => <FaceStage {...args} />,
};

/** The output: two jacks and a gain knob, three cells wide. */
export const AudioOut: StoryObj<Args> = {
  args: { moduleId: "io.audioOut", values: { gain: 0.5 } },
  render: (args) => <FaceStage {...args} />,
};

/** An LFO on the sawtooth's Sync: the knob turns, and the notch says where it is set. */
export const Modulated: StoryObj<Args> = {
  args: { moduleId: "osc.sawtooth", values: { sync: 0.5 }, liveParam: "sync" },
  render: (args) => <FaceStage {...args} />,
};

/** A module that declared no face wears the composed one: ports down the sides, its primary knobs between. */
export const Composed: StoryObj<Args> = {
  args: {
    moduleId: "filter.multi",
    values: { cutoff: 0.6, resonance: 0.3, drive: 0.1, mix: 1 },
  },
  argTypes: {
    moduleId: {
      control: "select",
      options: CATALOG.modules.filter((m) => m.face === null).map((m) => m.id),
    },
  },
  render: (args) => <FaceStage {...args} />,
};

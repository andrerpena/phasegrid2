import { hexToNumber } from "@renderer/lib/color";
import { useThemeStore } from "@renderer/theming/theme-store";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Container } from "pixi.js";
import { useCallback } from "react";
import { PixiStage } from "../stories/PixiStage";
import { SimpleWave } from "./SimpleWave";

/**
 * The wave panel a module wears next to its knobs.
 *
 * In the application the curve comes from the engine (`module.preview`): the module that makes the
 * sound draws it. The panel itself knows nothing about waveforms, which is why it can be shown here
 * with a few cycles made up on the spot.
 */
const meta: Meta = {
  title: "Grid/SimpleWave",
  parameters: { layout: "centered" },
};
export default meta;

const N = 512;
const cycle = (f: (phase: number) => number) =>
  Float32Array.from({ length: N }, (_, i) => f(i / N));
const SHAPES = {
  sine: cycle((p) => Math.sin(2 * Math.PI * p)),
  saw: cycle((p) => 2 * p - 1),
  square: cycle((p) => (p < 0.5 ? 1 : -1)),
  /** A saw synced fifteen semitones up: the shape `osc.sawtooth` draws at that setting. */
  synced: cycle((p) => 2 * ((p * 2 ** (15 / 12)) % 1) - 1),
} as const;
type Shape = keyof typeof SHAPES;

interface Args {
  shape: Shape;
  width: number;
  height: number;
}

const useStyle = () => {
  const theme = useThemeStore((s) => s.theme);
  return {
    curve: hexToNumber(theme.grid.signal.audio),
    grid: hexToNumber(theme.grid.gridLine),
    background: hexToNumber(theme.grid.background),
    border: hexToNumber(theme.grid.nodeStroke),
  };
};

const WaveStage = ({ shape, width, height }: Args) => {
  const style = useStyle();
  const build = useCallback(() => {
    const view = new Container();
    const wave = new SimpleWave(width, height, style);
    wave.setSamples(SHAPES[shape]);
    wave.view.position.set((260 - width) / 2, (160 - height) / 2);
    view.addChild(wave.view);
    return { view, destroy: () => wave.destroy() };
  }, [shape, width, height, style]);
  return <PixiStage build={build} width={260} height={160} />;
};

export const Default: StoryObj<Args> = {
  args: { shape: "synced", width: 96, height: 56 },
  argTypes: {
    shape: { control: { type: "select" }, options: Object.keys(SHAPES) },
    width: { control: { type: "range", min: 32, max: 220, step: 4 } },
    height: { control: { type: "range", min: 24, max: 140, step: 4 } },
  },
  render: (args) => <WaveStage {...args} />,
};

/**
 * At the size a module face actually gives the panel. This is the story to look at when judging
 * whether the drawing survives being small, which is the only size that matters in a patch.
 */
export const OnAFace: StoryObj = {
  render: () => {
    const Row = () => {
      const style = useStyle();
      const build = useCallback(() => {
        const view = new Container();
        for (const [i, shape] of (Object.keys(SHAPES) as Shape[]).entries()) {
          const wave = new SimpleWave(42, 32, style);
          wave.setSamples(SHAPES[shape]);
          wave.view.position.set(24 + i * 60, 64);
          view.addChild(wave.view);
        }
        return { view };
      }, [style]);
      return <PixiStage build={build} width={280} height={160} />;
    };
    return <Row />;
  },
};

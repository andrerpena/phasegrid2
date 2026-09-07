import { hexToNumber } from "@renderer/lib/color";
import { useThemeStore } from "@renderer/theming/theme-store";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Container } from "pixi.js";
import { useCallback } from "react";
import { PixiStage } from "../stories/PixiStage";
import { SimpleWave } from "./SimpleWave";
import { pulseWave, type WaveShape, waveShape } from "./wave-shapes";

/**
 * The wave panel a module wears next to its knobs.
 *
 * Four oscillators sitting side by side on a patch are the same box with the same two knobs, and the
 * title is what people stop reading first. The picture is what tells them apart.
 */
const meta: Meta = {
  title: "Grid/SimpleWave",
  parameters: { layout: "centered" },
};
export default meta;

interface Args {
  shape: WaveShape;
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
    wave.setSamples(waveShape(shape));
    wave.view.position.set((260 - width) / 2, (160 - height) / 2);
    view.addChild(wave.view);
    return { view, destroy: () => wave.destroy() };
  }, [shape, width, height, style]);
  return <PixiStage build={build} width={260} height={160} />;
};

export const Default: StoryObj<Args> = {
  args: { shape: "sine", width: 96, height: 56 },
  argTypes: {
    shape: {
      control: { type: "select" },
      options: ["sine", "triangle", "square", "saw", "pulse"],
    },
    width: { control: { type: "range", min: 32, max: 220, step: 4 } },
    height: { control: { type: "range", min: 24, max: 140, step: 4 } },
  },
  render: (args) => <WaveStage {...args} />,
};

/**
 * The four basic shapes together, at the size a module face actually gives them: two grid cells by two.
 * This is the story to look at when judging whether the drawing survives being small, which is the only
 * size that matters in a patch.
 */
export const BasicShapes: StoryObj = {
  render: () => {
    const Row = () => {
      const style = useStyle();
      const build = useCallback(() => {
        const view = new Container();
        const shapes: WaveShape[] = ["sine", "triangle", "square", "saw"];
        for (const [i, shape] of shapes.entries()) {
          const wave = new SimpleWave(48, 48, style);
          wave.setSamples(waveShape(shape));
          wave.view.position.set(16 + i * 64, 56);
          view.addChild(wave.view);
        }
        return { view };
      }, [style]);
      return <PixiStage build={build} width={280} height={160} />;
    };
    return <Row />;
  },
};

/**
 * Pulse widths from narrow to square. A width the panel cannot resolve should still read as a pulse
 * rather than as a flat line, which is what the nearest-sample resampling is there to guarantee.
 */
export const PulseWidths: StoryObj = {
  render: () => {
    const Row = () => {
      const style = useStyle();
      const build = useCallback(() => {
        const view = new Container();
        for (const [i, width] of [0.05, 0.15, 0.25, 0.5].entries()) {
          const wave = new SimpleWave(48, 48, style);
          wave.setSamples(pulseWave(width));
          wave.view.position.set(16 + i * 64, 56);
          view.addChild(wave.view);
        }
        return { view };
      }, [style]);
      return <PixiStage build={build} width={280} height={160} />;
    };
    return <Row />;
  },
};

/**
 * A wave pushed past full scale, as a wavefolder does. It is clamped to the panel rather than rescaled
 * to fit: rescaling would draw a folded wave as though nothing had been done to it.
 */
export const OverDriven: StoryObj = {
  render: () => {
    const Panel = () => {
      const style = useStyle();
      const build = useCallback(() => {
        const view = new Container();
        const wave = new SimpleWave(160, 80, style);
        wave.setSamples(
          Array.from(
            { length: 512 },
            (_, i) => Math.sin((2 * Math.PI * i) / 512) * 2.2,
          ),
        );
        wave.view.position.set(50, 40);
        view.addChild(wave.view);
        return { view, destroy: () => wave.destroy() };
      }, [style]);
      return <PixiStage build={build} width={260} height={160} />;
    };
    return <Panel />;
  },
};

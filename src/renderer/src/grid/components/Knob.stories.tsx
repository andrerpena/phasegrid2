import { hexToNumber } from "@renderer/lib/color";
import { useThemeStore } from "@renderer/theming/theme-store";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Container } from "pixi.js";
import { useCallback } from "react";
import { PixiStage } from "../stories/PixiStage";
import { Knob } from "./Knob";

/**
 * The knob is the control a module wears on its face. The arc is what makes a patch readable from
 * across the room: it says where a value sits in its range without anyone reading a number.
 */
const meta: Meta = {
  title: "Grid/Knob",
  parameters: { layout: "centered" },
};
export default meta;

interface Args {
  value: number;
  radius: number;
  label: string;
}

const KnobStage = ({ value, radius, label }: Args) => {
  const theme = useThemeStore((s) => s.theme);
  const build = useCallback(() => {
    const view = new Container();
    const knob = new Knob(radius, label, {
      arc: hexToNumber(theme.grid.signal.audio),
      track: hexToNumber(theme.grid.gridLine),
      body: hexToNumber(theme.grid.nodeFill),
      pointer: 0xd8dae0,
      label: 0x8a8f98,
    });
    knob.update(value);
    knob.view.position.set(90, 60);
    view.addChild(knob.view);
    return { view, destroy: () => knob.destroy() };
  }, [value, radius, label, theme]);
  return <PixiStage build={build} width={180} height={130} />;
};

export const Default: StoryObj<Args> = {
  args: { value: 0.65, radius: 17, label: "Cutoff" },
  argTypes: {
    value: { control: { type: "range", min: 0, max: 1, step: 0.01 } },
  },
  render: (args) => <KnobStage {...args} />,
};

/** The ends of the range, where an off-by-one in the arc geometry shows up most clearly. */
export const Minimum: StoryObj<Args> = {
  args: { value: 0, radius: 17, label: "Cutoff" },
  render: (args) => <KnobStage {...args} />,
};

export const Maximum: StoryObj<Args> = {
  args: { value: 1, radius: 17, label: "Cutoff" },
  render: (args) => <KnobStage {...args} />,
};

/** Larger, for a module with room for one important control rather than four small ones. */
export const Large: StoryObj<Args> = {
  args: { value: 0.4, radius: 26, label: "Fold" },
  render: (args) => <KnobStage {...args} />,
};

import { hexToNumber } from "@renderer/lib/color";
import { useThemeStore } from "@renderer/theming/theme-store";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Container } from "pixi.js";
import { useCallback } from "react";
import { descriptor } from "../fixtures";
import { measureNode } from "../layout";
import { PixiStage } from "../stories/PixiStage";
import { KnobRow } from "./KnobRow";
import { faceStyle } from "./OscillatorFace";

/**
 * The knobs a module wears when it has no wave to show: the face of most modules. Laid out by
 * `measureNode` from a real descriptor, so the row is exactly as wide as the patch draws it.
 */
const meta: Meta = {
  title: "Grid/KnobRow",
  parameters: { layout: "centered" },
};
export default meta;

interface Args {
  moduleId: string;
  values: Record<string, number>;
}

const RowStage = ({ moduleId, values }: Args) => {
  const theme = useThemeStore((s) => s.theme);
  const module = descriptor(moduleId);
  const build = useCallback(() => {
    const layout = measureNode(module);
    const view = new Container();
    const row = new KnobRow(
      layout.controls,
      faceStyle(theme.grid, hexToNumber(theme.grid.signal.cv)).knob,
    );
    for (const [id, fraction] of Object.entries(values))
      row.setValue(id, fraction);
    view.addChild(row.view);
    view.position.set(0, 12);
    return { view, destroy: () => row.destroy() };
  }, [module, values, theme]);
  const layout = measureNode(module);
  return (
    <PixiStage build={build} width={layout.width} height={layout.height} />
  );
};

/** The envelope's four stages. */
export const Envelope: StoryObj<Args> = {
  args: {
    moduleId: "env.dahdsr",
    values: { attack: 0.2, decay: 0.5, sustain: 0.7, release: 0.4 },
  },
  render: (args) => <RowStage {...args} />,
};

/** One knob, centred. */
export const Single: StoryObj<Args> = {
  args: { moduleId: "amp.vca", values: { gain: 0.5 } },
  render: (args) => <RowStage {...args} />,
};

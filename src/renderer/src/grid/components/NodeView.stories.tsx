import { hexToNumber } from "@renderer/lib/color";
import { useThemeStore } from "@renderer/theming/theme-store";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Container } from "pixi.js";
import { useCallback } from "react";
import { descriptor, moduleNode } from "../stories/fixtures";
import { PixiStage } from "../stories/PixiStage";
import { NodeView } from "./NodeView";

/**
 * A whole module, built from the engine's own descriptor with no engine running.
 *
 * Everything on the node comes from that descriptor: its title, how many ports it has, what colour each
 * one is, and which parameters it wears on its face. Nothing here maps a module id to an appearance,
 * which is what makes adding a module to the engine enough to see it drawn.
 */
const meta: Meta = { title: "Grid/Node", parameters: { layout: "centered" } };
export default meta;

const ACCENT: Record<string, "audio" | "cv" | "note" | "phase" | "any"> = {
  osc: "audio",
  filter: "audio",
  amp: "audio",
  env: "cv",
  mod: "cv",
  notes: "note",
  note: "note",
  phase: "phase",
  io: "any",
};

const NodeStage = ({
  type,
  selected,
  params,
}: {
  type: string;
  selected: boolean;
  params?: Record<string, number>;
}) => {
  const theme = useThemeStore((s) => s.theme);
  const build = useCallback(() => {
    const view = new Container();
    const desc = descriptor(type);
    const node = new NodeView(
      moduleNode("demo", type, params === undefined ? {} : { params }),
      desc,
      {
        colors: theme.grid,
        accent: hexToNumber(theme.grid.signal[ACCENT[desc.category] ?? "any"]),
      },
    );
    node.setSelected(selected);
    node.setPosition(24, 20);
    view.addChild(node.view);
    return { view, destroy: () => node.destroy() };
  }, [type, selected, params, theme]);
  return <PixiStage build={build} width={340} height={200} />;
};

interface Args {
  type: string;
  selected: boolean;
}

const render = (args: Args) => <NodeStage {...args} />;

/** The amplifier: two real inputs, one knob, one output. The simplest shape a module takes. */
export const Vca: StoryObj<Args> = {
  args: { type: "amp.vca", selected: false },
  render,
};

/** The envelope: four knobs on its face and the rest of its parameters in the inspector. */
export const Envelope: StoryObj<Args> = {
  args: { type: "env.dahdsr", selected: false },
  render,
};

/**
 * The oscillator, the widest control surface in the catalogue. This is the case that decided the rule:
 * a node shows the parameters meant to be moved while it plays, and the inspector holds the rest.
 */
export const Oscillator: StoryObj<Args> = {
  args: { type: "osc.wavetable", selected: false },
  render,
};

export const Selected: StoryObj<Args> = {
  args: { type: "filter.multi", selected: true },
  render,
};

/** A note source. Its ports carry events rather than signal, and read green. */
export const Clip: StoryObj<Args> = {
  args: { type: "notes.clip", selected: false },
  render,
};

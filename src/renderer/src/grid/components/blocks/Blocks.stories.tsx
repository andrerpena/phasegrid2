import { hexToNumber } from "@renderer/lib/color";
import { useThemeStore } from "@renderer/theming/theme-store";
import type { SignalRole } from "@shared/protocol/catalog";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Container, Text } from "pixi.js";
import { useCallback } from "react";
import { composeFace, type JackBlock as JackGeometry } from "../../face";
import { descriptor } from "../../fixtures";
import { CELL } from "../../layout";
import { PixiStage } from "../../stories/PixiStage";
import { blockStyle } from "./Block";
import { JackBlock } from "./JackBlock";
import { KnobBlock } from "./KnobBlock";
import { WaveBlock } from "./WaveBlock";

/**
 * The blocks a face is made of, one at a time.
 *
 * Each takes its geometry from `face.ts` and its colours from the theme and draws, with no store and
 * no engine. If a block cannot be shown through this, it is reading something it should have been
 * given.
 */
const meta: Meta = {
  title: "Grid/Blocks",
  parameters: { layout: "centered" },
};
export default meta;

const sine = descriptor("osc.sine");

interface KnobArgs {
  value: number;
  /** Where modulation has put the value, or nothing plugged in. */
  live?: number | null;
}

const KnobStage = ({ value, live = null }: KnobArgs) => {
  const theme = useThemeStore((s) => s.theme);
  const build = useCallback(() => {
    const geometry = composeFace(sine).knobs[0];
    const knob = new KnobBlock(
      geometry,
      blockStyle(theme.grid, hexToNumber(theme.grid.signal.audio)),
    );
    knob.setValue(value);
    knob.setLive(live);
    knob.update({ connected: live !== null });
    // The block places itself at its spot on the face; the stage shows it alone, at the origin.
    knob.view.position.set(12, 12);
    const view = new Container();
    view.addChild(knob.view);
    return { view, destroy: () => knob.destroy() };
  }, [value, live, theme]);
  return <PixiStage build={build} width={72} height={80} />;
};

/** A knob with its value arc, its label, and the modulation socket at its foot. */
export const Knob: StoryObj<KnobArgs> = {
  args: { value: 0.65 },
  argTypes: {
    value: { control: { type: "range", min: 0, max: 1, step: 0.01 } },
  },
  render: (args) => <KnobStage {...args} />,
};

/**
 * Something is plugged into the knob. The pointer and arc are where modulation has put the value;
 * the notch on the track is where the knob itself is set, which is what a drag changes.
 */
export const KnobModulated: StoryObj<KnobArgs> = {
  args: { value: 0.5, live: 0.8 },
  argTypes: {
    value: { control: { type: "range", min: 0, max: 1, step: 0.01 } },
    live: { control: { type: "range", min: 0, max: 1, step: 0.01 } },
  },
  render: (args) => <KnobStage {...args} />,
};

const ROLES: SignalRole[] = [
  "any",
  "audio",
  "cv",
  "gate",
  "pitch",
  "phase",
  "note",
];

const JacksStage = () => {
  const theme = useThemeStore((s) => s.theme);
  const build = useCallback(() => {
    const view = new Container();
    const style = blockStyle(theme.grid, hexToNumber(theme.grid.signal.audio));
    ROLES.forEach((role, i) => {
      // A jack in the middle of a face, so the socket sits at the cell's centre.
      const geometry: JackGeometry = {
        kind: "jack",
        name: role,
        col: 1,
        row: i,
        cols: 1,
        rows: 1,
        x: 0,
        y: i * CELL,
        width: CELL,
        height: CELL,
        socket: {
          port: {
            id: role,
            name: role,
            kind: "continuous",
            role,
            doc: "",
            implicit: false,
          },
          side: "input",
          facing: "left",
          x: CELL / 2,
          y: i * CELL + CELL / 2,
        },
      };
      const empty = new JackBlock(geometry, style);
      empty.view.position.set(12, 12 + i * CELL);
      const connected = new JackBlock(geometry, style);
      connected.update({ connected: true });
      connected.view.position.set(12 + CELL + 4, 12 + i * CELL);
      const label = new Text({
        text: role,
        style: {
          fontSize: 10,
          fill: style.knob.label,
          fontFamily: "system-ui, sans-serif",
        },
      });
      label.position.set(12 + 2 * CELL + 12, 12 + i * CELL + 6);
      view.addChild(empty.view, connected.view, label);
    });
    return { view };
  }, [theme]);
  return (
    <PixiStage build={build} width={140} height={ROLES.length * CELL + 24} />
  );
};

/** Every signal role, empty and connected: the colour legend the grid draws with. */
export const Jacks: StoryObj = { render: () => <JacksStage /> };

interface WaveArgs {
  wave: "sine" | "saw" | "square";
}

const N = 256;
const cycle = (f: (phase: number) => number) =>
  Float32Array.from({ length: N }, (_, i) => f(i / N));
const WAVES = {
  sine: cycle((p) => -Math.cos(2 * Math.PI * p)),
  saw: cycle((p) => 2 * p - 1),
  square: cycle((p) => (p < 0.5 ? 1 : -1)),
};

const WaveStage = ({ wave }: WaveArgs) => {
  const theme = useThemeStore((s) => s.theme);
  const build = useCallback(() => {
    const geometry = composeFace(sine).wave;
    if (geometry === null) throw new Error("the sine has a wave");
    const block = new WaveBlock(
      geometry,
      blockStyle(theme.grid, hexToNumber(theme.grid.signal.audio)),
    );
    block.setWave(WAVES[wave]);
    block.view.position.set(12, 12);
    const view = new Container();
    view.addChild(block.view);
    return { view, destroy: () => block.destroy() };
  }, [wave, theme]);
  return <PixiStage build={build} width={96} height={72} />;
};

/** The wave panel, drawing a cycle handed to it. */
export const Wave: StoryObj<WaveArgs> = {
  args: { wave: "sine" },
  argTypes: { wave: { control: "select", options: ["sine", "saw", "square"] } },
  render: (args) => <WaveStage {...args} />,
};

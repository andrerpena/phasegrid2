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
import { MeterBlock } from "./MeterBlock";
import { ScopeBlock } from "./ScopeBlock";
import { ValueBlock } from "./ValueBlock";
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

interface ScopeArgs {
  signal: "tone" | "noise" | "silence";
}

/** A window as the engine would publish it: 1024 frames, the oldest first, stereo. */
const WINDOW = 1024;
const frames = (f: (i: number) => number, right = 0.5) => {
  const left = Float32Array.from({ length: WINDOW }, (_, i) => f(i));
  return [left, left.map((v) => v * right)];
};
const SIGNALS = {
  tone: frames((i) => Math.sin((2 * Math.PI * i * 5.5) / WINDOW + 1)),
  noise: frames((i) => (((i * 9301 + 49297) % 233280) / 233280) * 2 - 1),
  silence: frames(() => 0),
};

const ScopeStage = ({ signal }: ScopeArgs) => {
  const theme = useThemeStore((s) => s.theme);
  const build = useCallback(() => {
    const geometry = composeFace(descriptor("display.scope")).scope;
    if (geometry === null) throw new Error("the scope has a scope");
    const block = new ScopeBlock(
      geometry,
      blockStyle(theme.grid, hexToNumber(theme.grid.signal.audio)),
    );
    block.setTrace(SIGNALS[signal]);
    block.view.position.set(12 - geometry.x, 12 - geometry.y);
    const view = new Container();
    view.addChild(block.view);
    return { view, destroy: () => block.destroy() };
  }, [signal, theme]);
  return <PixiStage build={build} width={120} height={96} />;
};

/** The scope, drawing a window handed to it: a tone held still by the trigger, noise as a band. */
export const Scope: StoryObj<ScopeArgs> = {
  args: { signal: "tone" },
  argTypes: {
    signal: { control: "select", options: ["tone", "noise", "silence"] },
  },
  render: (args) => <ScopeStage {...args} />,
};

interface ValueArgs {
  left: number;
  right: number;
}

const ValueStage = ({ left, right }: ValueArgs) => {
  const theme = useThemeStore((s) => s.theme);
  const build = useCallback(() => {
    const geometry = composeFace(descriptor("display.value")).readout;
    if (geometry === null) throw new Error("the readout has one");
    const block = new ValueBlock(
      geometry,
      blockStyle(theme.grid, hexToNumber(theme.grid.signal.cv)),
    );
    block.setValue([left, right]);
    block.view.position.set(12 - geometry.x, 12 - geometry.y);
    const view = new Container();
    view.addChild(block.view);
    return { view, destroy: () => block.destroy() };
  }, [left, right, theme]);
  return <PixiStage build={build} width={96} height={72} />;
};

/** The readout: one number for a mono signal, one per channel when they differ. */
export const Value: StoryObj<ValueArgs> = {
  args: { left: -0.25, right: -0.25 },
  argTypes: {
    left: { control: { type: "range", min: -2, max: 2, step: 0.01 } },
    right: { control: { type: "range", min: -2, max: 2, step: 0.01 } },
  },
  render: (args) => <ValueStage {...args} />,
};

interface MeterArgs {
  left: number;
  right: number;
  clipped: boolean;
}

const MeterStage = ({ left, right, clipped }: MeterArgs) => {
  const theme = useThemeStore((s) => s.theme);
  const build = useCallback(() => {
    const geometry = composeFace(descriptor("display.meter")).meter;
    if (geometry === null) throw new Error("the meter has one");
    const block = new MeterBlock(
      geometry,
      blockStyle(theme.grid, hexToNumber(theme.grid.signal.audio)),
    );
    block.setLevel({
      // A held peak sits a little above the level itself, which is what the notch shows.
      peak: [Math.min(1.5, left * 1.2), Math.min(1.5, right * 1.2)],
      rms: [left, right],
      clipped: [clipped ? 1 : 0, clipped ? 1 : 0],
    });
    block.view.position.set(12 - geometry.x, 12 - geometry.y);
    const view = new Container();
    view.addChild(block.view);
    return { view, destroy: () => block.destroy() };
  }, [left, right, clipped, theme]);
  return <PixiStage build={build} width={96} height={72} />;
};

/** The level meter: a bar per channel, the held peak over it, and the clip light. */
export const Meter: StoryObj<MeterArgs> = {
  args: { left: 0.5, right: 0.25, clipped: false },
  argTypes: {
    left: { control: { type: "range", min: 0, max: 1.5, step: 0.01 } },
    right: { control: { type: "range", min: 0, max: 1.5, step: 0.01 } },
  },
  render: (args) => <MeterStage {...args} />,
};

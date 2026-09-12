import { hexToNumber } from "@renderer/lib/color";
import { useThemeStore } from "@renderer/theming/theme-store";
import type { SignalRole } from "@shared/protocol/catalog";
import {
  type EnvelopeReading,
  TelemetryKind,
} from "@shared/protocol/telemetry";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Container, Text } from "pixi.js";
import { useCallback } from "react";
import { composeFace, type JackBlock as JackGeometry } from "../../face";
import { descriptor } from "../../fixtures";
import { CELL } from "../../layout";
import { PixiStage } from "../../stories/PixiStage";
import { AdsrBlock } from "./AdsrBlock";
import { blockStyle } from "./Block";
import { JackBlock } from "./JackBlock";
import { KnobBlock } from "./KnobBlock";
import { MeterBlock } from "./MeterBlock";
import { PianoBlock } from "./PianoBlock";
import { ScopeBlock } from "./ScopeBlock";
import { SelectBlock } from "./SelectBlock";
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

interface PianoArgs {
  octaves: number;
  low: number;
  /** The MIDI notes held, as a comma-separated list. */
  held: string;
}

const PianoStage = ({ octaves, low, held }: PianoArgs) => {
  const theme = useThemeStore((s) => s.theme);
  const build = useCallback(() => {
    const geometry = composeFace(descriptor("display.piano")).piano;
    if (geometry === null) throw new Error("the piano has one");
    const block = new PianoBlock(
      geometry,
      blockStyle(theme.grid, hexToNumber(theme.grid.signal.pitch)),
    );
    block.setRange({ low, octaves });
    block.setKeys(
      held
        .split(",")
        .map((s) => Number.parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n)),
    );
    block.view.position.set(12 - geometry.x, 12 - geometry.y);
    const view = new Container();
    view.addChild(block.view);
    return { view, destroy: () => block.destroy() };
  }, [octaves, low, held, theme]);
  return <PixiStage build={build} width={geometryWidth() + 24} height={72} />;
};

/** The keyboard on the piano's face, as wide as the engine declared it. */
function geometryWidth(): number {
  return composeFace(descriptor("display.piano")).piano?.width ?? 168;
}

/** The keyboard: white and black keys across the block, the held ones lit in the accent. */
export const Piano: StoryObj<PianoArgs> = {
  args: { octaves: 2, low: 3, held: "60, 64, 67" },
  argTypes: {
    octaves: { control: { type: "range", min: 1, max: 6, step: 1 } },
    low: { control: { type: "range", min: -1, max: 8, step: 1 } },
  },
  render: (args) => <PianoStage {...args} />,
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

interface EnvelopeArgs {
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  playhead: number;
}

/**
 * A picture as the engine would publish it. Straight segments, since the point of the story is the
 * block's drawing -- the breakpoints, the dashed sustain, the playhead -- and not the envelope's maths,
 * which lives in the engine and is tested there.
 */
const CURVE_POINTS = 120;
function envelopeReading(args: EnvelopeArgs): EnvelopeReading {
  const total = args.attack + args.decay + args.release || 1;
  const span = 1 - 0.25;
  const attackEnd = (args.attack / total) * span;
  const decayEnd = attackEnd + (args.decay / total) * span;
  const sustainEnd = decayEnd + 0.25;
  const level = (x: number): number => {
    if (x < attackEnd) return x / (attackEnd || 1);
    if (x < decayEnd)
      return (
        1 - (1 - args.sustain) * ((x - attackEnd) / (decayEnd - attackEnd))
      );
    if (x < sustainEnd) return args.sustain;
    if (x < 1)
      return args.sustain * (1 - (x - sustainEnd) / (1 - sustainEnd || 1));
    return 0;
  };
  const curve = Float32Array.from({ length: CURVE_POINTS }, (_, i) =>
    level(i / (CURVE_POINTS - 1)),
  );
  return {
    kind: TelemetryKind.Envelope,
    blockIndex: 1n,
    attackEnd,
    decayEnd,
    sustainEnd,
    sustain: args.sustain,
    playhead:
      args.playhead < 0 ? null : { x: args.playhead, y: level(args.playhead) },
    stage: 2,
    curve,
  };
}

const EnvelopeStage = (args: EnvelopeArgs) => {
  const theme = useThemeStore((s) => s.theme);
  const build = useCallback(() => {
    const geometry = composeFace(descriptor("env.adsr")).adsr;
    if (geometry === null) throw new Error("the envelope has a picture");
    const block = new AdsrBlock(
      geometry,
      blockStyle(theme.grid, hexToNumber(theme.grid.signal.cv)),
    );
    block.setEnvelope(envelopeReading(args));
    block.view.position.set(12 - geometry.x, 12 - geometry.y);
    const view = new Container();
    view.addChild(block.view);
    return { view, destroy: () => block.destroy() };
  }, [args, theme]);
  return (
    <PixiStage
      build={build}
      width={(composeFace(descriptor("env.adsr")).adsr?.width ?? 192) + 24}
      height={72}
    />
  );
};

/** The envelope picture: the shape, a dot on each corner, the sustain dashed, and the playhead. */
export const Envelope: StoryObj<EnvelopeArgs> = {
  args: { attack: 0.1, decay: 0.5, sustain: 0.5, release: 0.4, playhead: 0.3 },
  argTypes: {
    attack: { control: { type: "range", min: 0, max: 2, step: 0.01 } },
    decay: { control: { type: "range", min: 0, max: 2, step: 0.01 } },
    sustain: { control: { type: "range", min: 0, max: 1, step: 0.01 } },
    release: { control: { type: "range", min: 0, max: 2, step: 0.01 } },
    playhead: { control: { type: "range", min: -1, max: 1, step: 0.01 } },
  },
  render: (args) => <EnvelopeStage {...args} />,
};

interface SelectArgs {
  value: number;
  cols: number;
}

const SelectStage = ({ value, cols }: SelectArgs) => {
  const theme = useThemeStore((s) => s.theme);
  const build = useCallback(() => {
    const declared = composeFace(descriptor("env.adsr")).selects[0];
    if (declared === undefined) throw new Error("the envelope has a switch");
    // Widened here rather than on the module: the point of the story is that one cell shows an
    // initial and a wider block shows the whole word.
    const geometry = { ...declared, cols, width: cols * CELL };
    const block = new SelectBlock(
      geometry,
      blockStyle(theme.grid, hexToNumber(theme.grid.signal.cv)),
    );
    block.setValue(value);
    block.view.position.set(12 - geometry.x, 12 - geometry.y);
    const view = new Container();
    view.addChild(block.view);
    return { view, destroy: () => block.destroy() };
  }, [value, cols, theme]);
  return <PixiStage build={build} width={cols * CELL + 24} height={72} />;
};

/** The enum switch: an initial at one cell, the whole label from two across. */
export const Select: StoryObj<SelectArgs> = {
  args: { value: 0, cols: 1 },
  argTypes: {
    value: { control: { type: "range", min: 0, max: 2, step: 1 } },
    cols: { control: { type: "range", min: 1, max: 5, step: 1 } },
  },
  render: (args) => <SelectStage {...args} />,
};

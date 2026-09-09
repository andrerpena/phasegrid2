import { CELL } from "@renderer/grid/layout";
import type { PatchDoc, PatchModule } from "@shared/protocol/patch";
import {
  DEFAULT_SCALE,
  DEFAULT_TIME_SIGNATURE,
  type ProjectDoc,
} from "@shared/protocol/project";

/**
 * One example per module: the smallest patch that shows what that module does, and proves it does it.
 *
 * These are starting points rather than documents. Opening one copies it into the workspace as a
 * project of the user's own, so a person can hear what a control does without first having to build a
 * context for it, and can then keep going — move things, add things, save it — in the patch they were
 * already looking at. Nothing here is read-only; the copy is the point.
 *
 * They are written out by hand, one at a time, and each is checked by rendering it and measuring the
 * result. An example that does not make the sound it claims to is worse than no example.
 */

export interface ModuleExample {
  /** The module being demonstrated. One example per module id. */
  moduleId: string;
  /** Shown in the tab and in the command palette. */
  name: string;
  /** One sentence: what this shows, and what to turn. */
  description: string;
  tempo?: number;
  patch: PatchDoc;
}

const EXAMPLES = new Map<string, ModuleExample>();

function register(example: ModuleExample): void {
  EXAMPLES.set(example.moduleId, example);
}

export function exampleFor(moduleId: string): ModuleExample | undefined {
  return EXAMPLES.get(moduleId);
}

export function allExamples(): ModuleExample[] {
  return [...EXAMPLES.values()].sort((a, b) =>
    a.moduleId.localeCompare(b.moduleId),
  );
}

/**
 * A fresh project copied from an example.
 *
 * A copy, not a reference: the patch is cloned so that editing the new project cannot reach back into
 * the registry, and the id is new so that opening the same example twice gives two projects rather
 * than one tab that quietly replaces its own contents. The name is the caller's, because only the
 * caller knows which names the workspace already holds.
 */
export function projectFromExample(
  example: ModuleExample,
  name: string,
  id: string,
): ProjectDoc {
  return {
    schemaVersion: 1,
    id,
    name,
    description: example.description,
    tempo: example.tempo ?? 120,
    timeSignature: DEFAULT_TIME_SIGNATURE,
    scale: DEFAULT_SCALE,
    patch: structuredClone(example.patch),
  };
}

// ---------------------------------------------------------------------------------------------------
// The examples themselves. Positions are in whole cells, as everywhere on the grid.

const col = (n: number) => n * CELL;

/**
 * The simplest thing in the catalogue that makes a sound: an oscillator and an output.
 *
 * Nothing is plugged into the oscillator's pitch, so it runs at middle C, which is what makes this the
 * smallest possible demonstration. Verified by rendering it: the strongest partial is at 262 Hz, one
 * bin from middle C's 261.63.
 */
register({
  moduleId: "osc.wavetable",
  name: "Wavetable Oscillator",
  description:
    "An oscillator on its own, playing a saw at middle C. Turn Level for volume, Tune for pitch and " +
    "Pan to hear what they do to a bare tone.",
  patch: {
    schemaVersion: 1,
    voiceCount: 1,
    feedbackMode: "sample",
    modules: [
      {
        id: "osc",
        type: "osc.wavetable",
        x: col(2),
        y: col(2),
        // Table 6 is the saw: every harmonic, so it is the shape you can hear a filter working on, and
        // the one the face draws. The default table morphs across four shapes and so has no single
        // curve to show.
        params: { level: 0.7, table: 6 },
      },
      {
        id: "out",
        type: "io.audioOut",
        x: col(16),
        y: col(3),
        params: { gain: 0.5 },
      },
    ],
    edges: [
      {
        id: "e1",
        from: { module: "osc", port: "out" },
        to: { module: "out", port: "inL" },
      },
    ],
  },
});

/**
 * The sawtooth on its own. The one knob is Sync: at 0 st a plain saw; turned up, the wave on its face
 * changes as the sound does, because both come from the same formula in the module.
 */
register({
  moduleId: "osc.sawtooth",
  name: "Sawtooth",
  description:
    "A sawtooth at middle C. Turn Sync up and watch the wave on its face change as you hear the " +
    "sync harmonics come in.",
  patch: {
    schemaVersion: 1,
    voiceCount: 1,
    feedbackMode: "sample",
    modules: [
      {
        id: "osc",
        type: "osc.sawtooth",
        x: col(2),
        y: col(2),
        params: { sync: 0 },
      },
      {
        id: "out",
        type: "io.audioOut",
        x: col(12),
        y: col(3),
        params: { gain: 0.4 },
      },
    ],
    edges: [
      {
        id: "e1",
        from: { module: "osc", port: "out" },
        to: { module: "out", port: "inL" },
      },
    ],
  },
});

/**
 * The pulse on its own. Same one knob as the sawtooth, and the same thing to watch: the face redraws
 * as you turn it, because the picture and the sound come from the same shape in the same module.
 */
register({
  moduleId: "osc.pulse",
  name: "Pulse",
  description:
    "A square at middle C. Turn Sync up to pack more pulses into each cycle, and watch the wave on " +
    "its face fill up as you hear the harmonics arrive.",
  patch: {
    schemaVersion: 1,
    voiceCount: 1,
    feedbackMode: "sample",
    modules: [
      {
        id: "osc",
        type: "osc.pulse",
        x: col(2),
        y: col(2),
        params: { sync: 0 },
      },
      {
        id: "out",
        type: "io.audioOut",
        x: col(12),
        y: col(3),
        params: { gain: 0.4 },
      },
    ],
    edges: [
      {
        id: "e1",
        from: { module: "osc", port: "out" },
        to: { module: "out", port: "inL" },
      },
    ],
  },
});

/**
 * The sine and its folder. Fold starts at zero, where the wave is the one shape with no harmonics at
 * all, so there is something to hear the moment the knob moves.
 */
register({
  moduleId: "osc.sine",
  name: "Sine",
  description:
    "A sine at middle C. Turn Fold up to drive the wave past full scale and reflect it back on " +
    "itself: the arch on its face grows lobes, and the tone gains harmonics with no filter involved.",
  patch: {
    schemaVersion: 1,
    voiceCount: 1,
    feedbackMode: "sample",
    modules: [
      {
        id: "osc",
        type: "osc.sine",
        x: col(2),
        y: col(2),
        params: { fold: 0 },
      },
      {
        id: "out",
        type: "io.audioOut",
        x: col(12),
        y: col(3),
        params: { gain: 0.4 },
      },
    ],
    edges: [
      {
        id: "e1",
        from: { module: "osc", port: "out" },
        to: { module: "out", port: "inL" },
      },
    ],
  },
});

/** An oscillator, used as the sound source in most of these. Middle C unless told otherwise. */
function source(id = "osc", params: Record<string, number> = {}) {
  return {
    id,
    type: "osc.wavetable",
    x: col(2),
    y: col(2),
    params: { level: 0.7, ...params },
  };
}

const OUT = {
  id: "out",
  type: "io.audioOut",
  x: col(26),
  y: col(3),
  params: { gain: 0.5 },
};
const edge = (id: string, from: [string, string], to: [string, string]) => ({
  id,
  from: { module: from[0], port: from[1] },
  to: { module: to[0], port: to[1] },
});

/**
 * The shape most examples take: a source, the module under test in the middle, and the output.
 *
 * Three modules is the smallest patch that can demonstrate an effect: without a source there is
 * nothing to hear it act on, and without an output there is nothing to hear.
 */
function throughExample(args: {
  moduleId: string;
  name: string;
  description: string;
  params?: Record<string, number>;
  sourceParams?: Record<string, number>;
}): ModuleExample {
  return {
    moduleId: args.moduleId,
    name: args.name,
    description: args.description,
    patch: {
      schemaVersion: 1,
      voiceCount: 1,
      feedbackMode: "sample",
      modules: [
        source("osc", args.sourceParams),
        {
          id: "unit",
          type: args.moduleId,
          x: col(13),
          y: col(2),
          params: args.params ?? {},
        },
        OUT,
      ],
      edges: [
        edge("e1", ["osc", "out"], ["unit", "in"]),
        edge("e2", ["unit", "out"], ["out", "inL"]),
      ],
    },
  };
}

/** A source whose level is driven by something: how a modulator or an envelope is demonstrated. */
function modulatedExample(args: {
  moduleId: string;
  name: string;
  description: string;
  /** The port on the module under test that drives the amplifier. */
  outPort?: string;
  params?: Record<string, number>;
  extraModules?: {
    id: string;
    type: string;
    x: number;
    y: number;
    params?: Record<string, number>;
  }[];
  extraEdges?: {
    id: string;
    from: { module: string; port: string };
    to: { module: string; port: string };
  }[];
}): ModuleExample {
  return {
    moduleId: args.moduleId,
    name: args.name,
    description: args.description,
    patch: {
      schemaVersion: 1,
      voiceCount: 1,
      feedbackMode: "sample",
      modules: [
        source(),
        {
          id: "unit",
          type: args.moduleId,
          x: col(13),
          y: col(9),
          params: args.params ?? {},
        },
        // The amplifier's own knob is at zero so what you hear is entirely what the module is doing.
        {
          id: "vca",
          type: "amp.vca",
          x: col(20),
          y: col(2),
          params: { gain: 0 },
        },
        OUT,
        ...(args.extraModules ?? []),
      ],
      edges: [
        edge("e1", ["osc", "out"], ["vca", "in"]),
        edge("e2", ["unit", args.outPort ?? "out"], ["vca", "gain"]),
        edge("e3", ["vca", "out"], ["out", "inL"]),
        ...(args.extraEdges ?? []),
      ],
    },
  };
}

// --- The output itself -------------------------------------------------------------------------

register({
  moduleId: "io.audioOut",
  name: "Audio Out",
  description:
    "Where sound leaves the engine. Turn Gain; everything else in a patch ends here.",
  patch: {
    schemaVersion: 1,
    voiceCount: 1,
    feedbackMode: "sample",
    modules: [source(), OUT],
    edges: [edge("e1", ["osc", "out"], ["out", "inL"])],
  },
});

// --- Through a module --------------------------------------------------------------------------

register(
  throughExample({
    moduleId: "amp.vca",
    name: "VCA",
    description:
      "An amplifier between the oscillator and the output. Turn Gain to hear it open and close; " +
      "the Gain input adds to the knob, which is how an envelope drives it.",
    params: { gain: 0.6 },
  }),
);

register(
  throughExample({
    moduleId: "filter.multi",
    name: "Filter",
    description:
      "A filter on a bare tone. Turn Cutoff to hear the harmonics go, and Resonance to hear it ring.",
    params: { cutoff: 70, resonance: 0.4 },
  }),
);

register(
  throughExample({
    moduleId: "math.scaleOffset",
    name: "Scale / Offset",
    description:
      "Multiplies and adds. Here it is scaling the audio itself, which is the clearest way to hear " +
      "what the two knobs do; more usually it conditions a control signal.",
    params: { scale: 0.6, offset: 0 },
  }),
);

const EFFECTS: [string, string, string, Record<string, number>][] = [
  [
    "fx.reverb",
    "Reverb",
    "Reverb on a bare tone. Turn Dry/Wet, then Decay Time and Size.",
    { dry_wet: 0.6 },
  ],
  [
    "fx.delay",
    "Delay",
    "A delay line. Turn Dry/Wet for how much, Frequency for the time, Feedback for repeats.",
    { dry_wet: 0.5, feedback: 0.5 },
  ],
  [
    "fx.chorus",
    "Chorus",
    "Chorus on a bare tone. Turn Dry/Wet, then Mod Depth and Frequency.",
    { dry_wet: 0.6 },
  ],
  [
    "fx.flanger",
    "Flanger",
    "Flanger on a bare tone. Turn Feedback for the sweep to bite.",
    { dry_wet: 0.6, feedback: 0.6 },
  ],
  [
    "fx.phaser",
    "Phaser",
    "Phaser on a bare tone. Turn Mod Depth and Frequency to hear it move.",
    { dry_wet: 0.7 },
  ],
  [
    "fx.distortion",
    "Distortion",
    "Distortion. Turn Drive; Mix blends it against the clean tone.",
    { mix: 0.8, drive: 0.6 },
  ],
  [
    "fx.eq",
    "Equalizer",
    "Three bands. Turn the gains to hear each band come and go.",
    { low_gain: 6, high_gain: -6 },
  ],
  [
    "fx.compressor",
    "Compressor",
    "Compression on a steady tone. Turn Mix, then Attack and Release.",
    { mix: 1 },
  ],
];

for (const [moduleId, name, description, params] of EFFECTS) {
  register(throughExample({ moduleId, name, description, params }));
}

// --- Driving something else --------------------------------------------------------------------

/**
 * The LFO driving a knob, which is what it is for.
 *
 * Its output goes into the socket under the sine's Fold, so the knob turns on its own: the pointer
 * follows the engine's effective value while the notch stays where the knob is set. Fold sits at
 * twelve semitones and the LFO swings it half its range either side, so the sound sweeps from a
 * plain sine into folded lobes and back once every two seconds: slowly enough to watch.
 */
register({
  moduleId: "mod.lfo",
  name: "LFO",
  description:
    "An LFO sweeping the sine's Fold through the socket under the knob. Watch Fold turn by itself; " +
    "turn Rate, Shape and Depth to change how it moves.",
  patch: {
    schemaVersion: 1,
    voiceCount: 1,
    feedbackMode: "sample",
    modules: [
      {
        id: "lfo",
        type: "mod.lfo",
        x: col(2),
        y: col(9),
        params: { rate: 0.5, depth: 0.5 },
      },
      {
        id: "osc",
        type: "osc.sine",
        x: col(2),
        y: col(2),
        params: { fold: 12 },
      },
      {
        id: "out",
        type: "io.audioOut",
        x: col(14),
        y: col(3),
        params: { gain: 0.4 },
      },
    ],
    edges: [
      edge("e1", ["lfo", "out"], ["osc", "param:fold"]),
      edge("e2", ["osc", "out"], ["out", "inL"]),
    ],
  },
});

register(
  modulatedExample({
    moduleId: "mod.random",
    name: "Random",
    description:
      "A random signal opening and closing the amplifier. Turn Frequency for how often it moves.",
    params: { frequency: 4 },
  }),
);

register(
  modulatedExample({
    moduleId: "phase.clock",
    name: "Clock",
    description:
      "A transport-locked ramp driving the amplifier, so each cycle is a swell. Turn Swing to hear " +
      "every other cycle move.",
    outPort: "phase",
  }),
);

// --- Notes -------------------------------------------------------------------------------------

/** Four notes, a beat apart: enough to hear pitch change and a rhythm. */
const ARPEGGIO = {
  notes: [60, 64, 67, 72].map((pitch, step) => ({
    start: step,
    length: 0.9,
    pitch,
    velocity: 0.8,
  })),
};

/**
 * A clip driving an oscillator's pitch through a note-to-voice converter.
 *
 * Three of the note modules are demonstrated by the same shape, because that shape is the smallest
 * one in which any of them does anything: a clip with nothing to convert its notes is silent, and a
 * converter with no clip has nothing to convert.
 */
/** The clip every note example is built around, unless one asks for a different source. */
const CLIP_SOURCE: Omit<PatchModule, "id" | "x" | "y"> = {
  type: "notes.clip",
  params: { length: 4, loop: 1 },
  data: ARPEGGIO,
};

function noteExample(args: {
  moduleId: string;
  name: string;
  description: string;
  converter: "note.toPoly" | "note.toCv";
  /** What plays the notes. The clip, unless the example is about something else that does. */
  source?: Omit<PatchModule, "id" | "x" | "y">;
}): ModuleExample {
  return {
    moduleId: args.moduleId,
    name: args.name,
    description: args.description,
    patch: {
      schemaVersion: 1,
      voiceCount: 1,
      feedbackMode: "sample",
      modules: [
        {
          id: "clip",
          ...(args.source ?? CLIP_SOURCE),
          x: col(2),
          y: col(2),
        },
        { id: "voices", type: args.converter, x: col(11), y: col(2) },
        {
          id: "osc",
          type: "osc.wavetable",
          x: col(15),
          y: col(2),
          params: { level: 0.7 },
        },
        {
          id: "vca",
          type: "amp.vca",
          x: col(28),
          y: col(2),
          params: { gain: 0 },
        },
        {
          id: "env",
          type: "env.dahdsr",
          x: col(15),
          y: col(9),
          params: { attack: 0.15, decay: 0.85, sustain: 0, release: 0.6 },
        },
        { ...OUT, x: col(34) },
      ],
      edges: [
        edge("e1", ["clip", "notes"], ["voices", "notes"]),
        edge("e2", ["voices", "pitch"], ["osc", "pitch"]),
        edge("e3", ["voices", "gate"], ["env", "gate"]),
        edge("e4", ["osc", "out"], ["vca", "in"]),
        edge("e5", ["env", "out"], ["vca", "gain"]),
        edge("e6", ["vca", "out"], ["out", "inL"]),
      ],
    },
  };
}

register(
  noteExample({
    moduleId: "notes.clip",
    name: "Clip",
    description:
      "Four notes played against the transport, looping. Turn Transpose to move them, and Length to " +
      "change how far the playhead runs before it wraps.",
    converter: "note.toPoly",
  }),
);

register(
  noteExample({
    moduleId: "notes.pattern",
    name: "Pattern",
    description:
      "A whole musical idea in one string, in the mini-notation TidalCycles invented: `<c4 eb4>` " +
      "takes one note per cycle, `g3*2` plays twice as fast, `[~ bb3]` rests then plays, and " +
      "`[c4,g4]` is a chord. Edit it in the inspector and it changes as it plays.",
    converter: "note.toPoly",
    source: {
      type: "notes.pattern",
      params: { cycle: 4, legato: 0.9 },
      data: {
        pattern: "<c4 eb4> g3*2 [~ bb3] [c4,g4]",
        velocity: "1 0.4 0.8",
      },
    },
  }),
);

register(
  noteExample({
    moduleId: "note.toPoly",
    name: "Note to Poly",
    description:
      "Turns a note stream into pitch, gate and velocity, one note per voice. Raise the project's " +
      "voice count and a chord plays as a chord rather than as one note.",
    converter: "note.toPoly",
  }),
);

register(
  noteExample({
    moduleId: "note.toCv",
    name: "Note to CV",
    description:
      "The monophonic converter: whichever note wins the priority rule sounds. Turn Glide to slide " +
      "from one note to the next, and Priority to change which one wins.",
    converter: "note.toCv",
  }),
);

register({
  moduleId: "env.dahdsr",
  name: "Envelope",
  description:
    "An envelope shaping each note. Turn Attack, Decay, Sustain and Release and hear the shape " +
    "change. The amplifier's own knob is at zero, so what you hear is entirely the envelope.",
  patch: noteExample({
    moduleId: "env.dahdsr",
    name: "",
    description: "",
    converter: "note.toPoly",
  }).patch,
});

// --- Mixing and metering -------------------------------------------------------------------------

register({
  moduleId: "mix.mixer",
  name: "Mixer",
  description:
    "Two oscillators a fifth apart into one output. Turn Level 1 and Level 2 to balance them, and " +
    "hear one disappear.",
  patch: {
    schemaVersion: 1,
    voiceCount: 1,
    feedbackMode: "sample",
    modules: [
      source("oscA", { level: 0.7 }),
      { ...source("oscB", { level: 0.7, tune: 7 }), y: col(9) },
      {
        id: "unit",
        type: "mix.mixer",
        x: col(15),
        y: col(4),
        params: { level1: 0.6, level2: 0.4 },
      },
      { ...OUT, x: col(24) },
    ],
    edges: [
      edge("e1", ["oscA", "out"], ["unit", "in1"]),
      edge("e2", ["oscB", "out"], ["unit", "in2"]),
      edge("e3", ["unit", "out"], ["out", "inL"]),
    ],
  },
});

/**
 * The two display modules produce no sound: they publish what passes through them for the interface
 * to draw. So their examples put one across a working signal path, and the audible part is the
 * oscillator behind it. The render test proves the patch sounds; that a meter is actually publishing
 * is a telemetry question the offline renderer cannot answer.
 */
function displayExample(
  moduleId: string,
  name: string,
  description: string,
): ModuleExample {
  return {
    moduleId,
    name,
    description,
    patch: {
      schemaVersion: 1,
      voiceCount: 1,
      feedbackMode: "sample",
      modules: [
        source(),
        { id: "unit", type: moduleId, x: col(13), y: col(9) },
        { ...OUT, x: col(20) },
      ],
      edges: [
        edge("e1", ["osc", "out"], ["out", "inL"]),
        edge("e2", ["osc", "out"], ["unit", "in"]),
      ],
    },
  };
}

register(
  displayExample(
    "display.meter",
    "Meter",
    "A meter tapping the signal on its way to the output, showing its level on its face. It " +
      "changes nothing: a tap is a tap. Turn the oscillator's Fold to push it into the clip light.",
  ),
);

register(
  displayExample(
    "display.value",
    "Value",
    "A readout showing what is on the wire as a number. Turn the oscillator's Fold and watch it " +
      "move; it reads the signal itself, sign and all, rather than how loud it is.",
  ),
);

register(
  displayExample(
    "display.scope",
    "Scope",
    "A scope tapping the signal on its way to the output, drawing it on its face as it plays. Turn " +
      "the oscillator's Fold and watch the trace bend; turn Time to see more or less of it.",
  ),
);

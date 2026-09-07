import { CELL } from "@renderer/grid/layout";
import type { PatchDoc } from "@shared/protocol/patch";
import {
  DEFAULT_SCALE,
  DEFAULT_TIME_SIGNATURE,
  type ProjectDoc,
} from "@shared/protocol/project";

/**
 * One example project per module: the smallest patch that shows what that module does, and proves it
 * does it.
 *
 * These are demonstrations rather than documents. Their wiring is fixed and every knob is live, so a
 * person can hear what a control does without first having to build a context for it, and so a broken
 * module is obvious rather than something you find out about three patches later.
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

/** Turns an example into the project that gets opened. */
export function projectForExample(example: ModuleExample): ProjectDoc {
  return {
    schemaVersion: 1,
    id: `example:${example.moduleId}`,
    name: example.name,
    description: example.description,
    tempo: example.tempo ?? 120,
    timeSignature: DEFAULT_TIME_SIGNATURE,
    scale: DEFAULT_SCALE,
    patch: example.patch,
    kind: "example",
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
    "An oscillator on its own, at middle C. Turn Level for volume, Tune for pitch, and Phase and Pan " +
    "to hear what they do to a bare tone.",
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
        params: { level: 0.7 },
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

import { z } from "zod";
import { PatchDocSchema } from "./patch";

/**
 * A project: a patch, plus everything about the piece that is not the graph.
 *
 * Tempo, meter and scale live here rather than in the patch because they belong to the music, not to
 * the wiring. Two patches in one project share them; the same patch in another project should not drag
 * the old tempo along with it.
 */

/**
 * The scale a project is in.
 *
 * It is here because it is a property of the piece rather than of any module, and because the modules
 * that read it — `notefx.quantize` today; arpeggiators and generative note sources later — need
 * somewhere to read it from that is not one of their own parameters. It reaches them through the
 * engine's transport, beside the tempo and the meter (`transport.setScale`).
 */
export const SCALE_NAMES = [
  "chromatic",
  "major",
  "minor",
  "harmonicMinor",
  "melodicMinor",
  "dorian",
  "phrygian",
  "lydian",
  "mixolydian",
  "locrian",
  "majorPentatonic",
  "minorPentatonic",
  "blues",
  "wholeTone",
] as const;

export type ScaleName = (typeof SCALE_NAMES)[number];

/**
 * What each scale is: the semitones above its root, ascending, starting at 0.
 *
 * The one table a scale name resolves through. The engine takes intervals, not names
 * (`transport.setScale`), so it never has to know what "dorian" means, and a scale added here is a
 * scale everywhere. The `Record` type is what makes forgetting one a type error rather than a silent gap.
 */
export const SCALE_INTERVALS: Record<ScaleName, readonly number[]> = {
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
  melodicMinor: [0, 2, 3, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  wholeTone: [0, 2, 4, 6, 8, 10],
};

export const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

export const ScaleSchema = z.object({
  /** 0 is C, as in the pitch convention everywhere else. */
  root: z.number().int().min(0).max(11),
  name: z.enum(SCALE_NAMES),
});

export const TimeSignatureSchema = z
  .object({
    numerator: z.number().int().min(1).max(64),
    /** A note value, so it must be a power of two. */
    denominator: z.number().int().min(1).max(64),
  })
  .refine((t) => (t.denominator & (t.denominator - 1)) === 0, {
    message: "the denominator is a note value and must be a power of two",
  });

export const ProjectDocSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  name: z.string().min(1),
  tempo: z.number().min(20).max(400),
  timeSignature: TimeSignatureSchema,
  scale: ScaleSchema,
  patch: PatchDocSchema,
  /**
   * Where it lives inside the workspace: the name of its folder under `projects/`.
   *
   * Absent only for a project that has never been saved. Assigned when a project is loaded or first
   * written, and stripped again before it is serialised, so the folder name is the only record of where
   * a project is. That is what lets someone rename or move the folder and have the project follow,
   * rather than leaving a document that confidently points at nothing.
   */
  slug: z.string().optional(),
  /** Shown above the grid. A project made from an example starts with the example's own sentence. */
  description: z.string().optional(),
});

export type Scale = z.infer<typeof ScaleSchema>;
export type TimeSignature = z.infer<typeof TimeSignatureSchema>;
export type ProjectDoc = z.infer<typeof ProjectDocSchema>;

export const DEFAULT_TIME_SIGNATURE: TimeSignature = {
  numerator: 4,
  denominator: 4,
};
export const DEFAULT_SCALE: Scale = { root: 0, name: "chromatic" };

export function scaleLabel(scale: Scale): string {
  const root = NOTE_NAMES[scale.root] ?? "C";
  // "majorPentatonic" reads as "Major Pentatonic": these come from an identifier and are shown to a
  // person, so the split happens here rather than in a table that would have to be kept in step.
  const name = scale.name
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase());
  return `${root} ${name}`;
}

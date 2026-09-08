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
 * Nothing consumes it yet. It is here because it is a property of the piece rather than of any module,
 * and because the modules that will read it — quantisers, arpeggiators, generative note sources — need
 * somewhere to read it from that is not one of their own parameters.
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
   * Where this project came from, and therefore what can be done to it.
   *
   * An `example` ships with the application and demonstrates one module. Its wiring is fixed — nothing
   * can be moved, added, removed or reconnected — but every knob and property can be changed, because
   * turning them is how you find out what the module does and that it works. It opens framed on its
   * own modules rather than on an open canvas.
   *
   * The restriction is deliberate and is about honesty rather than protection. An example has nowhere
   * to save to, so if it behaved like an ordinary project people would build in one and discover only
   * afterwards that the work cannot be kept. Making it plainly a demonstration means nobody starts.
   */
  kind: z.enum(["example", "user"]).default("user"),
  /**
   * Where it lives inside the workspace: the name of its folder under `projects/`.
   *
   * Absent for an example, and for a user project that has never been saved. Assigned when a project is
   * loaded or first written, and stripped again before it is serialised, so the folder name is the only
   * record of where a project is. That is what lets someone rename or move the folder and have the
   * project follow, rather than leaving a document that confidently points at nothing.
   */
  slug: z.string().optional(),
  /** Shown above the grid. An example says what it is demonstrating. */
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

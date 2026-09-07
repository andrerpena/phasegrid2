import { CatalogSchema, type ModuleDescriptor } from "@shared/protocol/catalog";
import type { PatchDoc, PatchModule } from "@shared/protocol/patch";
import golden from "../../../../../engine/tests/golden/catalog.json";

/**
 * Real module descriptors, with no engine running.
 *
 * This is the catalogue the engine itself prints, committed as a golden file and already checked by a
 * test that compares it against a live `--catalog`. So a story draws the same ports, roles and
 * parameters the application will, and cannot drift into a fiction that only exists in Storybook.
 *
 * Parsed rather than cast, so a change to the engine's output that breaks the schema breaks the stories
 * too, which is where it should be noticed.
 */
export const CATALOG = CatalogSchema.parse(golden);

export const DESCRIPTORS = new Map<string, ModuleDescriptor>(
  CATALOG.modules.map((m) => [m.id, m]),
);

export function descriptor(id: string): ModuleDescriptor {
  const found = DESCRIPTORS.get(id);
  if (found === undefined)
    throw new Error(`no module ${id} in the golden catalog`);
  return found;
}

export function moduleNode(
  id: string,
  type: string,
  over: Partial<PatchModule> = {},
): PatchModule {
  return { id, type, x: 0, y: 0, ...over };
}

/** A small patch that exercises node shapes, port roles and cable colours together. */
export const DEMO_PATCH: PatchDoc = {
  schemaVersion: 1,
  voiceCount: 4,
  feedbackMode: "sample",
  modules: [
    moduleNode("clip", "notes.clip", { x: 30, y: 120 }),
    moduleNode("voices", "note.toPoly", { x: 210, y: 120 }),
    moduleNode("osc", "osc.wavetable", { x: 380, y: 40 }),
    moduleNode("env", "env.dahdsr", { x: 380, y: 260 }),
    moduleNode("flt", "filter.multi", { x: 620, y: 40 }),
    moduleNode("vca", "amp.vca", { x: 620, y: 260 }),
    moduleNode("out", "io.audioOut", { x: 850, y: 150 }),
  ],
  edges: [
    {
      id: "e1",
      from: { module: "clip", port: "notes" },
      to: { module: "voices", port: "notes" },
    },
    {
      id: "e2",
      from: { module: "voices", port: "pitch" },
      to: { module: "osc", port: "pitch" },
    },
    {
      id: "e3",
      from: { module: "voices", port: "gate" },
      to: { module: "env", port: "gate" },
    },
    {
      id: "e4",
      from: { module: "osc", port: "out" },
      to: { module: "flt", port: "audio" },
    },
    {
      id: "e5",
      from: { module: "flt", port: "audio" },
      to: { module: "vca", port: "in" },
    },
    {
      id: "e6",
      from: { module: "env", port: "out" },
      to: { module: "vca", port: "gain" },
    },
    {
      id: "e7",
      from: { module: "vca", port: "out" },
      to: { module: "out", port: "inL" },
    },
  ],
};

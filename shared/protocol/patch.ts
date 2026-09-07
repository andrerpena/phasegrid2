import { z } from "zod";

/**
 * `PatchOp` is the single vocabulary for changing a patch. Undo history, engine synchronisation,
 * `patch.batch` and persistence all speak it, so an edit is described once and every consumer of that
 * description agrees on what happened.
 *
 * One op is user-interface only: `moduleMove` changes where a node is drawn and nothing the engine
 * computes, so engine sync drops it (`isEngineOp`) rather than waking the compiler for a drag. The
 * position still travels on `moduleAdd`, because a patch file has to remember its layout.
 */

/** One end of an edge: a port on a module. */
export const PortRefSchema = z.object({
  module: z.string().min(1),
  port: z.string().min(1),
});

/** Params are numeric everywhere; anything else is structured `data` the module owns. */
export const ParamValuesSchema = z.record(z.number());

/**
 * Structured state a module owns and no param can express: a clip's notes, a curve's breakpoints. Its
 * shape is the module's business, so nothing validates it here beyond "it is an object". The engine
 * treats it as structural and rebuilds the instance when it changes.
 */
export const NodeDataSchema = z.record(z.unknown());

export const ModuleAddOpSchema = z.object({
  op: z.literal("moduleAdd"),
  id: z.string().min(1),
  type: z.string().min(1),
  x: z.number().optional(),
  y: z.number().optional(),
  label: z.string().optional(),
  params: ParamValuesSchema.optional(),
  data: NodeDataSchema.optional(),
});

export const ModuleRemoveOpSchema = z.object({
  op: z.literal("moduleRemove"),
  id: z.string().min(1),
});

export const EdgeAddOpSchema = z.object({
  op: z.literal("edgeAdd"),
  id: z.string().min(1),
  from: PortRefSchema,
  to: PortRefSchema,
});

export const EdgeRemoveOpSchema = z.object({
  op: z.literal("edgeRemove"),
  id: z.string().min(1),
});

export const ParamSetOpSchema = z.object({
  op: z.literal("paramSet"),
  module: z.string().min(1),
  param: z.string().min(1),
  value: z.number(),
  /**
   * Mid-gesture: the knob is still under a hand.
   *
   * The value belongs in the document like any other — it is what every view draws, and there is no
   * second place a value is ever kept — but the gesture is not over, so it is not its own step back.
   * The one entry for the whole gesture is recorded when the hand lifts.
   */
  transient: z.boolean().optional(),
});

/** User-interface only: layout, not signal. `isEngineOp` is false for this and only this op. */
export const ModuleMoveOpSchema = z.object({
  op: z.literal("moduleMove"),
  id: z.string().min(1),
  x: z.number(),
  y: z.number(),
});

export const SetVoiceCountOpSchema = z.object({
  op: z.literal("setVoiceCount"),
  voiceCount: z.number().int().min(1).max(64),
});

export const PatchOpSchema = z.discriminatedUnion("op", [
  ModuleAddOpSchema,
  ModuleRemoveOpSchema,
  EdgeAddOpSchema,
  EdgeRemoveOpSchema,
  ParamSetOpSchema,
  ModuleMoveOpSchema,
  SetVoiceCountOpSchema,
]);

export type PortRef = z.infer<typeof PortRefSchema>;
export type PatchOp = z.infer<typeof PatchOpSchema>;
export type PatchOpKind = PatchOp["op"];

/** Ops the engine has no opinion about. Engine sync drops these before sending a batch. */
export const UI_ONLY_OPS = [
  "moduleMove",
] as const satisfies readonly PatchOpKind[];

export function isEngineOp(op: PatchOp): boolean {
  return !(UI_ONLY_OPS as readonly string[]).includes(op.op);
}

/** The ops worth sending to the engine, in order. An empty result means nothing needs sending at all. */
export function engineOps(ops: readonly PatchOp[]): PatchOp[] {
  return ops.filter(isEngineOp);
}

/** Per-sample feedback resolution costs CPU inside a cycle; `block` trades a block of delay for it. */
export const FeedbackModeSchema = z.enum(["sample", "block"]);

export const PatchModuleSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  params: ParamValuesSchema.optional(),
  data: NodeDataSchema.optional(),
  /** Layout. The engine ignores these; they are here so a saved patch reopens where it was left. */
  x: z.number().optional(),
  y: z.number().optional(),
  label: z.string().optional(),
});

export const PatchEdgeSchema = z.object({
  id: z.string().min(1),
  from: PortRefSchema,
  to: PortRefSchema,
});

/**
 * A whole patch, exactly as `engine/src/render/PatchFile.cpp` reads and writes it. This is the document
 * `--render` takes on the command line and the one `patch.load` takes over the socket, which is what
 * makes an offline render of a patch reproduce what the live engine plays.
 */
export const PatchDocSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().optional(),
  name: z.string().optional(),
  voiceCount: z.number().int().min(1).max(64).optional(),
  feedbackMode: FeedbackModeSchema.optional(),
  modules: z.array(PatchModuleSchema),
  edges: z.array(PatchEdgeSchema),
});

export type FeedbackMode = z.infer<typeof FeedbackModeSchema>;
export type PatchModule = z.infer<typeof PatchModuleSchema>;
export type PatchEdge = z.infer<typeof PatchEdgeSchema>;
export type PatchDoc = z.infer<typeof PatchDocSchema>;

export const EMPTY_PATCH: PatchDoc = {
  schemaVersion: 1,
  voiceCount: 1,
  feedbackMode: "sample",
  modules: [],
  edges: [],
};

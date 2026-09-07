import { z } from "zod";

/**
 * The module catalog the engine prints with `--catalog`: every registered module's ports, params, ranges,
 * units and enum labels, plus the conventions a patch is written in.
 *
 * These schemas are the renderer's only description of what a module is. Nothing here is hand-maintained
 * per module: adding a module to the engine changes the JSON, not this file. What this file does maintain
 * is the *shape* of that JSON, so a mismatch between the two surfaces as a parse error at startup rather
 * than as an undefined somewhere deep in the patch editor.
 */

/** Continuous ports carry a signal every frame; event ports carry notes and other discrete messages. */
export const PortKindSchema = z.enum(["continuous", "event"]);

/**
 * What a port means, for colouring and for the editor's connection hints only -- the engine never rejects a
 * patch over a role mismatch. Extending this list is how a new kind of signal is introduced.
 */
export const SignalRoleSchema = z.enum([
  "any",
  "audio",
  "cv",
  "gate",
  "pitch",
  "phase",
]);

export const ParamUnitSchema = z.enum([
  "none",
  "hz",
  "seconds",
  "db",
  "semitones",
  "percent",
  "ratio",
]);

export const ParamCurveSchema = z.enum(["linear", "log", "exp"]);

export const UiWidgetSchema = z.enum(["slider", "knob", "toggle", "select"]);

/**
 * One port. `implicit` marks the port the engine adds for a modulatable param (`param:<id>`): the editor
 * draws it on the knob rather than in the port list, and `param` says which knob.
 */
export const PortDescSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    kind: PortKindSchema,
    role: SignalRoleSchema,
    doc: z.string(),
    implicit: z.boolean(),
    param: z.string().optional(),
  })
  .strict()
  .refine((p) => p.implicit === (p.param !== undefined), {
    message:
      "an implicit port names the param it feeds, and only an implicit port does",
  });

export const ParamFlagsSchema = z
  .object({
    /** Takes a modulation signal; the engine gives it an implicit `param:<id>` input port. */
    modulatable: z.boolean(),
    integer: z.boolean(),
    enum: z.boolean(),
    hidden: z.boolean(),
    noSmooth: z.boolean(),
    /** Cannot be changed on a live node: the engine rebuilds the node instead. Never modulatable. */
    structural: z.boolean(),
  })
  .strict();

export const ParamDescSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    min: z.number(),
    max: z.number(),
    default: z.number(),
    unit: ParamUnitSchema,
    curve: ParamCurveSchema,
    flags: ParamFlagsSchema,
    enumLabels: z.array(z.string()).min(1).optional(),
    uiWidget: UiWidgetSchema,
    group: z.string().optional(),
    doc: z.string(),
  })
  .strict()
  .refine((p) => p.min < p.max, { message: "param needs min < max" })
  .refine((p) => p.default >= p.min && p.default <= p.max, {
    message: "param default is outside its own range",
  })
  .refine((p) => !p.flags.enum || p.enumLabels !== undefined, {
    message: "an enum param carries its labels",
  })
  .refine((p) => !(p.flags.structural && p.flags.modulatable), {
    message: "a structural param can never be modulatable",
  });

export const ModuleFlagsSchema = z
  .object({
    /** Writes to the engine output rather than to a port of its own. */
    terminal: z.boolean(),
    needsTransport: z.boolean(),
    writesTelemetry: z.boolean(),
  })
  .strict();

export const ModuleDescriptorSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    category: z.string().min(1),
    doc: z.string(),
    flags: ModuleFlagsSchema,
    inputs: z.array(PortDescSchema),
    outputs: z.array(PortDescSchema),
    params: z.array(ParamDescSchema),
  })
  .strict();

/** Engine-wide constants a patch is written against; the editor needs them to label pitch and time. */
export const ConventionsSchema = z
  .object({
    octavesPerUnit: z.number(),
    middleCHz: z.number(),
    gateThreshold: z.number(),
    blockSize: z.number().int().positive(),
    lanes: z.array(z.string()).length(4),
  })
  .strict();

export const CatalogSchema = z
  .object({
    /** 64-bit FNV-1a over the module list. The renderer caches by this and refetches when it moves. */
    catalogHash: z.string().regex(/^[0-9a-f]{16}$/),
    conventions: ConventionsSchema,
    modules: z.array(ModuleDescriptorSchema).min(1),
  })
  .strict()
  .refine(
    (c) => c.modules.every((m, i) => i === 0 || c.modules[i - 1].id < m.id),
    { message: "modules must be sorted by id and unique" },
  );

export type PortKind = z.infer<typeof PortKindSchema>;
export type SignalRole = z.infer<typeof SignalRoleSchema>;
export type ParamUnit = z.infer<typeof ParamUnitSchema>;
export type ParamCurve = z.infer<typeof ParamCurveSchema>;
export type PortDesc = z.infer<typeof PortDescSchema>;
export type ParamDesc = z.infer<typeof ParamDescSchema>;
export type ModuleDescriptor = z.infer<typeof ModuleDescriptorSchema>;
export type Catalog = z.infer<typeof CatalogSchema>;

/** The input port id the engine generates for a modulatable param. */
export function implicitPortId(paramId: string): string {
  return `param:${paramId}`;
}

export function findModule(
  catalog: Catalog,
  id: string,
): ModuleDescriptor | undefined {
  return catalog.modules.find((m) => m.id === id);
}

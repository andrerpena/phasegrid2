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
 *
 * `note` is a role, not a kind: it marks an event port carrying a stream of pitch and velocity, where an
 * event port carrying bare triggers stays `gate`. Each role has a `--color-signal-<role>` token.
 */
export const SignalRoleSchema = z.enum([
  "any",
  "audio",
  "cv",
  "gate",
  "pitch",
  "phase",
  "note",
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
    /**
     * The module wants this control on its face.
     *
     * Which handful of a module's parameters matter is the module's knowledge: nothing about a
     * parameter table says a filter's cutoff is reached for more often than its formant spread. So the
     * engine says, and the interface shows these without being asked.
     */
    primary: z.boolean(),
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

/**
 * A string a module owns: a note pattern, a sample path, an expression.
 *
 * Params are numbers everywhere, because a number can be smoothed, modulated and swept. A string
 * can do none of those, so it lives in the node's `data` under this id and is *structural* -- the
 * engine rebuilds the node when it changes. Declaring it here is what lets the interface generate
 * an editor for it, the same way it generates a knob from a param.
 */
export const TextDescSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    default: z.string(),
    flags: z.object({ multiline: z.boolean() }).strict(),
    /** Which editor mode to open. Absent, or a name we do not know, is plain text. */
    language: z.string().optional(),
    placeholder: z.string().optional(),
    doc: z.string(),
  })
  .strict();

export const ModuleFlagsSchema = z
  .object({
    /** Writes to the engine output rather than to a port of its own. */
    terminal: z.boolean(),
    needsTransport: z.boolean(),
    writesTelemetry: z.boolean(),
    /**
     * Can draw one cycle of itself: `module.preview` returns it. The editor gives such a module a wave
     * panel on its face and asks the engine what to put in it, so the picture is computed from the
     * same parameters the sound is, by the module that makes the sound.
     */
    previewsWave: z.boolean(),
    /**
     * Its telemetry slot carries a rolling window of the signal it is fed (`TelemetryKind.Scope`).
     * The editor gives such a module a scope panel on its face and draws the window there, read from
     * the engine's segment at frame rate.
     */
    publishesScope: z.boolean(),
    /**
     * Its telemetry slot carries the last value on its input, per channel (`TelemetryKind.Value`).
     * The editor gives such a module a readout on its face and writes the number there.
     */
    publishesValue: z.boolean(),
    /**
     * Its telemetry slot carries the level on its input: held peak, RMS and a clip flag per channel
     * (`TelemetryKind.Meter`). The editor gives such a module a level meter on its face.
     */
    publishesMeter: z.boolean(),
    /** Publishes the notes it is playing, which is what a piano roll on its face is drawn from. */
    publishesNotes: z.boolean(),
  })
  .strict();

/**
 * A module's face: rows of tokens, one per grid cell, as the engine padded them (every row the same
 * length). Equal neighbouring tokens form one rectangular block, as CSS `grid-template-areas`. `.` is
 * an empty cell, `wave` the wave panel, `scope` the scope panel, `value` the readout, `meter` the
 * level meter, `text:<id>` a text property, anything else names a port (`in:`/`out:` when the two
 * sides share an id) or a param (`param:` when it collides with a port). The engine's registry has already
 * checked the geometry; the check here is only that every token still names something on the
 * module, which is what `composeFace` needs to be true.
 */
export const FaceSchema = z.array(z.array(z.string().min(1)).min(1)).min(1);

/** What a face token names on a module, or null for one that names nothing. `.` is `empty`. */
export function resolveFaceToken(
  module: {
    inputs: { id: string }[];
    outputs: { id: string }[];
    params: { id: string }[];
    texts?: { id: string }[];
  },
  token: string,
):
  | { kind: "empty" }
  | { kind: "wave" }
  | { kind: "scope" }
  | { kind: "value" }
  | { kind: "meter" }
  | { kind: "pianoRoll" }
  | { kind: "input" | "output" | "param" | "text"; id: string }
  | null {
  if (token === ".") return { kind: "empty" };
  if (token === "wave") return { kind: "wave" };
  if (token === "scope") return { kind: "scope" };
  if (token === "value") return { kind: "value" };
  if (token === "meter") return { kind: "meter" };
  if (token === "pianoRoll") return { kind: "pianoRoll" };
  // Implicit modulation ports never sit on a face; they ride on their param's control, so only a
  // declared input is a jack.
  const declared = module.inputs.filter(
    (p) => !("implicit" in p && p.implicit === true),
  );
  const has = (list: { id: string }[], id: string) =>
    list.some((p) => p.id === id);
  for (const [prefix, kind, list] of [
    ["in:", "input", declared],
    ["out:", "output", module.outputs],
    ["param:", "param", module.params],
    // A text property is always written out in full. Unlike a port or a param it is not something
    // a bare name could plausibly mean, and spelling it keeps a module with a `pattern` param and
    // a `pattern` string from being ambiguous.
    ["text:", "text", module.texts ?? []],
  ] as const) {
    if (!token.startsWith(prefix)) continue;
    const id = token.slice(prefix.length);
    return has(list, id) ? { kind, id } : null;
  }
  const input = has(declared, token);
  const output = has(module.outputs, token);
  const param = has(module.params, token);
  const matches = Number(input) + Number(output) + Number(param);
  if (matches !== 1) return null;
  if (input) return { kind: "input", id: token };
  if (output) return { kind: "output", id: token };
  return { kind: "param", id: token };
}

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
    texts: z.array(TextDescSchema),
    /** The declared face, or null for a module that leaves its face to the interface. */
    face: FaceSchema.nullable(),
  })
  .strict()
  .refine(
    (m) =>
      m.face === null ||
      m.face.every((row) => row.every((t) => resolveFaceToken(m, t) !== null)),
    { message: "every face token names a port or a param of the module" },
  )
  .refine(
    (m) =>
      m.face === null ||
      m.face.every((row) => row.length === m.face?.[0].length),
    { message: "a face is a rectangle: every row the same length" },
  );

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
export type TextDesc = z.infer<typeof TextDescSchema>;
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

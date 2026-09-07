import { z } from "zod";
import { CatalogSchema, ConventionsSchema } from "./catalog";
import {
  FeedbackModeSchema,
  NodeDataSchema,
  ParamValuesSchema,
  PatchDocSchema,
  PatchOpSchema,
  PortRefSchema,
} from "./patch";

/**
 * The command table: every request the engine answers, with the schema for its arguments and the schema
 * for its result. One table, two consumers -- the client gets `call<C>(cmd, args)` inference from it, and
 * the tests get an exhaustive list to walk. The engine's `services/Protocol.cpp` implements exactly these
 * names; a name here with no handler there is a lie the round-trip test would catch.
 *
 * `midi.*` and `telemetry.*` are deliberately absent. They belong to later phases, and a schema for a
 * command the engine does not implement is worse than no schema at all.
 */

const NoArgs = z.object({});

/** Every command that changes the graph answers with the revision its commit produced. */
const RevisionResultSchema = z.object({
  revision: z.number().int().nonnegative(),
});

/**
 * Where the telemetry ring lives, once there is one. Null until phase 5 opens the segment: the field is
 * in the handshake from the start so a client can ask "is there telemetry?" without a version check.
 */
export const ShmInfoSchema = z
  .object({
    name: z.string().min(1),
    size: z.number().int().positive(),
    layoutVersion: z.number().int().nonnegative(),
  })
  .nullable();

export const HelloResultSchema = z.object({
  protocolVersion: z.number().int().nonnegative(),
  engineVersion: z.string().min(1),
  catalogHash: z.string().regex(/^[0-9a-f]{16}$/),
  conventions: ConventionsSchema,
  shm: ShmInfoSchema,
  /** Optional features this build has. Absence is the answer to "can it?", never an error. */
  capabilities: z.array(z.string()),
});

/**
 * Where the transport is. The same shape answers every `transport.*` command and rides the
 * `transport.position` event, so a client that draws a playhead has one schema to know.
 */
export const TransportPositionSchema = z.object({
  playing: z.boolean(),
  tempo: z.number().positive(),
  ppq: z.number(),
  samplePos: z.number().int().nonnegative(),
});

export const AudioDeviceSchema = z.object({
  backend: z.string().min(1),
  id: z.string(),
  name: z.string(),
  isDefault: z.boolean(),
});

export const DeviceListResultSchema = z.object({
  devices: z.array(AudioDeviceSchema),
  /** The selected device id; empty means the system default is in use. */
  current: z.string(),
  sampleRate: z.number().positive(),
  channels: z.number().int().positive(),
});

export const COMMANDS = {
  /**
   * The handshake, and the only command that may be sent before compatibility is known. The engine
   * refuses a major version it cannot speak with `E_VERSION` rather than answering wrongly.
   */
  hello: {
    args: z.object({
      protocolVersion: z.number().int().nonnegative(),
      client: z.string().optional(),
    }),
    result: HelloResultSchema,
  },
  "engine.ping": {
    args: NoArgs,
    result: z.object({
      pong: z.literal(true),
      revision: z.number().int().nonnegative(),
    }),
  },
  /** Answered before the socket closes, so a deliberate shutdown is distinguishable from a crash. */
  "engine.shutdown": { args: NoArgs, result: z.object({}) },

  "catalog.get": { args: NoArgs, result: CatalogSchema },

  "patch.load": {
    args: z.object({ patch: PatchDocSchema }),
    result: RevisionResultSchema,
  },
  "patch.clear": { args: NoArgs, result: RevisionResultSchema },
  /**
   * Several ops, one commit, all or nothing. A failing op anywhere in the list leaves the engine exactly
   * as it was, which is what lets the interface treat one user gesture as one atomic edit.
   */
  "patch.batch": {
    args: z.object({ ops: z.array(PatchOpSchema) }),
    result: RevisionResultSchema,
  },
  "patch.setVoiceCount": {
    args: z.object({ voiceCount: z.number().int().min(1).max(64) }),
    result: RevisionResultSchema,
  },
  "patch.setFeedbackMode": {
    args: z.object({ mode: FeedbackModeSchema }),
    result: RevisionResultSchema,
  },

  "module.add": {
    args: z.object({
      id: z.string().min(1),
      type: z.string().min(1),
      params: ParamValuesSchema.optional(),
      data: NodeDataSchema.optional(),
    }),
    result: RevisionResultSchema,
  },
  "module.remove": {
    args: z.object({ id: z.string().min(1) }),
    result: RevisionResultSchema,
  },
  "edge.add": {
    args: z.object({
      id: z.string().min(1),
      from: PortRefSchema,
      to: PortRefSchema,
    }),
    result: RevisionResultSchema,
  },
  "edge.remove": {
    args: z.object({ id: z.string().min(1) }),
    result: RevisionResultSchema,
  },
  /**
   * `transient` is the param-drag path: the value goes to the document and to the audio thread's param
   * queue without recompiling the graph, so a knob can be dragged at frame rate. A structural param
   * ignores it, because the only way to apply one is to build the instance again.
   */
  "param.set": {
    args: z.object({
      module: z.string().min(1),
      param: z.string().min(1),
      value: z.number(),
      transient: z.boolean().optional(),
    }),
    result: RevisionResultSchema,
  },

  "transport.play": { args: NoArgs, result: TransportPositionSchema },
  "transport.stop": { args: NoArgs, result: TransportPositionSchema },
  "transport.setTempo": {
    args: z.object({ tempo: z.number().min(1).max(999) }),
    result: TransportPositionSchema,
  },
  "transport.seek": {
    args: z.object({ ppq: z.number().min(0) }),
    result: TransportPositionSchema,
  },

  "device.list": { args: NoArgs, result: DeviceListResultSchema },
  /** Empty id selects the system default. Reopens the device, so the audio stream stops and restarts. */
  "device.select": {
    args: z.object({ id: z.string() }),
    result: DeviceListResultSchema,
  },
} satisfies CommandTable;

export interface CommandDef {
  args: z.ZodTypeAny;
  result: z.ZodTypeAny;
}
export type CommandTable = Record<string, CommandDef>;

export type CommandName = keyof typeof COMMANDS;
export type CommandArgs<C extends CommandName> = z.infer<
  (typeof COMMANDS)[C]["args"]
>;
export type CommandResult<C extends CommandName> = z.infer<
  (typeof COMMANDS)[C]["result"]
>;

export const COMMAND_NAMES = Object.keys(COMMANDS) as CommandName[];

export function isCommandName(name: string): name is CommandName {
  return Object.hasOwn(COMMANDS, name);
}

/** The shape `window.engine.call` and the socket client both satisfy. */
export type EngineCall = <C extends CommandName>(
  cmd: C,
  args: CommandArgs<C>,
) => Promise<CommandResult<C>>;

/**
 * Events, the other half of the vocabulary: everything either side says without being asked. The first
 * six come from the engine process; `engine.connected` and `engine.crashed` come from the supervisor,
 * which is the only party that can see a restart, and reach the renderer on the same channel.
 */
export const EVENTS = {
  "engine.ready": z.object({
    engineVersion: z.string(),
    sampleRate: z.number().positive(),
    channels: z.number().int().positive(),
    blockSize: z.number().int().positive(),
  }),
  "engine.error": z.object({ code: z.string(), message: z.string() }),
  "engine.log": z.object({
    level: z.enum(["debug", "info", "warn", "error"]),
    message: z.string(),
  }),
  "patch.revision": z.object({ revision: z.number().int().nonnegative() }),
  "transport.position": TransportPositionSchema,
  "device.changed": DeviceListResultSchema,
  /** `restarted` is the reconciler's cue to resend the patch it still holds. */
  "engine.connected": z.object({ restarted: z.boolean() }),
  "engine.crashed": z.object({ message: z.string() }),
} satisfies Record<string, z.ZodTypeAny>;

export type EventName = keyof typeof EVENTS;
export type EventData<E extends EventName> = z.infer<(typeof EVENTS)[E]>;

export const EVENT_NAMES = Object.keys(EVENTS) as EventName[];

export function isEventName(name: string): name is EventName {
  return Object.hasOwn(EVENTS, name);
}

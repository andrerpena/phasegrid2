import { z } from "zod";

/**
 * The wire envelope every message between the interface and the engine is wrapped in.
 *
 * Requests are `{id, cmd, args}`, answers are `{id, ok:true, result}` or `{id, ok:false, error}`, and
 * anything the engine says on its own initiative is an event `{event, seq, data}`. One line of JSON per
 * message, newline delimited -- a message never contains a raw newline because `JSON.stringify` escapes
 * them, which is what makes the framing safe.
 *
 * Unknown keys are ignored on both sides: every schema here strips rather than rejects them, so a newer
 * engine may add a field to a response without breaking an older client. What is NOT tolerated is a
 * missing or wrong-typed field, because that is a real disagreement rather than a version skew.
 */

/** Echoed verbatim in the response, so the client can match an answer to its call. */
export const RequestIdSchema = z.union([
  z.number().int().nonnegative(),
  z.string().min(1),
]);

export const RequestSchema = z.object({
  id: RequestIdSchema,
  cmd: z.string().min(1),
  /** Per-command; `commands.ts` holds the schema that validates it. */
  args: z.unknown(),
});

export const ProtocolErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
});

export const OkResponseSchema = z.object({
  id: RequestIdSchema,
  ok: z.literal(true),
  /**
   * Per-command; `commands.ts` holds the schema that validates it. The refinement is what makes the key
   * required rather than optional: a bare `z.unknown()` accepts a missing key, and a success with no
   * result at all is a bug on the engine side worth surfacing here. A command with nothing to say
   * answers `{}`.
   */
  result: z.unknown().refine((v) => v !== undefined, {
    message: "a success carries a result",
  }),
});

/**
 * `id` is nullable because a line that does not parse as JSON, or parses without an id, still gets an
 * answer -- the engine cannot invent an id, and swallowing the line would leave the client waiting.
 */
export const ErrorResponseSchema = z.object({
  id: RequestIdSchema.nullable(),
  ok: z.literal(false),
  error: ProtocolErrorSchema,
});

export const ResponseSchema = z.discriminatedUnion("ok", [
  OkResponseSchema,
  ErrorResponseSchema,
]);

export const EventEnvelopeSchema = z.object({
  event: z.string().min(1),
  /** Monotonic per connection, from 1. A gap means an event was dropped, never reordered. */
  seq: z.number().int().nonnegative(),
  data: z.unknown(),
});

/**
 * The engine's error codes, as `Result::fail` produces them across the engine. This list is
 * documentation and a source of autocomplete, not a closed set: `ProtocolErrorSchema.code` stays a
 * plain string so a code added to a newer engine surfaces as itself rather than as a parse failure.
 */
export const ERROR_CODES = [
  "E_SCHEMA",
  "E_UNKNOWN_CMD",
  "E_UNKNOWN_TYPE",
  "E_VERSION",
  "E_NOT_FOUND",
  "E_NODE_NOT_FOUND",
  "E_EDGE_NOT_FOUND",
  "E_PORT_NOT_FOUND",
  "E_PARAM_NOT_FOUND",
  "E_DUP_ID",
  "E_DUP_EDGE",
  "E_KIND_MISMATCH",
  "E_FAN_IN",
  "E_VOICES",
  "E_EVENT_FEEDBACK",
  "E_QUEUE_FULL",
  "E_COMPILE",
  "E_IO",
  /** The command exists in this build but this engine cannot serve it right now, e.g. no telemetry
   * segment was opened. Deliberately distinct from E_UNKNOWN_CMD: "not in this build" and "not
   * available now" send a client to different places. */
  "E_UNSUPPORTED",
  /** More telemetry subscriptions were asked for than the segment has slots. */
  "E_NO_SLOTS",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
export type RequestId = z.infer<typeof RequestIdSchema>;
export type Request = z.infer<typeof RequestSchema>;
export type ProtocolError = z.infer<typeof ProtocolErrorSchema>;
export type Response = z.infer<typeof ResponseSchema>;
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

/** One message, framed. `JSON.stringify` escapes any newline inside the payload, so this is unambiguous. */
export function encodeLine(message: unknown): string {
  return `${JSON.stringify(message)}\n`;
}

/**
 * Newline framing, the half of it both readers need: a socket read may split a message anywhere and may
 * deliver several at once, so the remainder after the last newline has to survive until the next chunk.
 * Blank lines are skipped rather than reported as parse errors.
 */
export class LineBuffer {
  private carry = "";

  /** Appends a chunk and returns every complete line it finished. */
  push(chunk: string): string[] {
    this.carry += chunk;
    const lines: string[] = [];
    for (;;) {
      const nl = this.carry.indexOf("\n");
      if (nl < 0) break;
      const line = this.carry.slice(0, nl).trim();
      this.carry = this.carry.slice(nl + 1);
      if (line.length > 0) lines.push(line);
    }
    return lines;
  }

  /** What has been received since the last newline. Non-empty at end of stream means a truncated message. */
  get pending(): string {
    return this.carry;
  }

  reset(): void {
    this.carry = "";
  }
}

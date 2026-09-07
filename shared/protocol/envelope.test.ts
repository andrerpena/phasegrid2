import { describe, expect, it } from "vitest";
import {
  ERROR_CODES,
  EventEnvelopeSchema,
  encodeLine,
  LineBuffer,
  RequestSchema,
  ResponseSchema,
} from "./envelope";

describe("request envelope", () => {
  it("accepts a request and ignores keys it does not know", () => {
    const parsed = RequestSchema.parse({
      id: 7,
      cmd: "engine.ping",
      args: {},
      sentAt: 12345,
    });
    expect(parsed.id).toBe(7);
    expect(parsed.cmd).toBe("engine.ping");
    expect(parsed).not.toHaveProperty("sentAt");
  });

  it("rejects a request with no command or no id", () => {
    expect(RequestSchema.safeParse({ id: 1, args: {} }).success).toBe(false);
    expect(RequestSchema.safeParse({ id: 1, cmd: "", args: {} }).success).toBe(
      false,
    );
    expect(RequestSchema.safeParse({ cmd: "hello", args: {} }).success).toBe(
      false,
    );
    expect(
      RequestSchema.safeParse({ id: { n: 1 }, cmd: "hello", args: {} }).success,
    ).toBe(false);
  });
});

describe("response envelope", () => {
  it("accepts success and failure", () => {
    const ok = ResponseSchema.parse({
      id: 1,
      ok: true,
      result: { pong: true },
    });
    expect(ok.ok).toBe(true);
    const err = ResponseSchema.parse({
      id: 1,
      ok: false,
      error: { code: "E_SCHEMA", message: "no" },
    });
    expect(err.ok).toBe(false);
    if (!err.ok) expect(err.error.code).toBe("E_SCHEMA");
  });

  it("answers an unparseable line with a null id", () => {
    const err = ResponseSchema.parse({
      id: null,
      ok: false,
      error: { code: "E_SCHEMA", message: "invalid JSON" },
    });
    expect(err.id).toBeNull();
  });

  it("rejects an envelope that is neither a success nor a failure", () => {
    // No `ok` at all: the discriminator is missing.
    expect(ResponseSchema.safeParse({ id: 1, result: {} }).success).toBe(false);
    // `ok:true` with an error body, and `ok:false` with no error: both are self-contradictory.
    expect(
      ResponseSchema.safeParse({
        id: 1,
        ok: true,
        error: { code: "E_SCHEMA", message: "no" },
      }).success,
    ).toBe(false);
    expect(ResponseSchema.safeParse({ id: 1, ok: false }).success).toBe(false);
    expect(
      ResponseSchema.safeParse({
        id: 1,
        ok: false,
        error: { message: "no code" },
      }).success,
    ).toBe(false);
    // A success needs an id: only a failure may carry a null one.
    expect(
      ResponseSchema.safeParse({ id: null, ok: true, result: {} }).success,
    ).toBe(false);
  });
});

describe("event envelope", () => {
  it("accepts an event and rejects one with no sequence number", () => {
    const e = EventEnvelopeSchema.parse({
      event: "patch.revision",
      seq: 3,
      data: { revision: 3 },
    });
    expect(e.seq).toBe(3);
    expect(
      EventEnvelopeSchema.safeParse({ event: "patch.revision", data: {} })
        .success,
    ).toBe(false);
    expect(
      EventEnvelopeSchema.safeParse({ event: "x", seq: 1.5, data: {} }).success,
    ).toBe(false);
  });
});

describe("error codes", () => {
  it("are the engine's own, all shaped E_*", () => {
    for (const code of ERROR_CODES) expect(code).toMatch(/^E_[A-Z_]+$/);
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });
});

describe("newline framing", () => {
  it("returns one line per complete message", () => {
    const buffer = new LineBuffer();
    expect(buffer.push(`${JSON.stringify({ id: 1 })}\n`)).toEqual(['{"id":1}']);
  });

  // Trap 2: a socket read splits wherever it likes. Without the carry buffer this drops the message.
  it("reassembles a message split mid-token across two chunks", () => {
    const buffer = new LineBuffer();
    const line = encodeLine({ id: 1, cmd: "engine.ping", args: {} });
    const cut = line.indexOf("engine") + 3; // inside the command name
    expect(buffer.push(line.slice(0, cut))).toEqual([]);
    const lines = buffer.push(line.slice(cut));
    expect(lines).toEqual([line.trim()]);
    expect(RequestSchema.parse(JSON.parse(lines[0])).cmd).toBe("engine.ping");
  });

  it("returns every message when several arrive in one chunk", () => {
    const buffer = new LineBuffer();
    const chunk =
      encodeLine({ id: 1, cmd: "a", args: {} }) +
      encodeLine({ id: 2, cmd: "b", args: {} }) +
      encodeLine({ id: 3, cmd: "c", args: {} });
    const lines = buffer.push(chunk);
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => RequestSchema.parse(JSON.parse(l)).cmd)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("keeps a trailing partial message pending rather than emitting it", () => {
    const buffer = new LineBuffer();
    const lines = buffer.push('{"id":1,"cmd":"a","args":{}}\n{"id":2,"cmd');
    expect(lines).toHaveLength(1);
    expect(buffer.pending).toBe('{"id":2,"cmd');
    expect(buffer.push('":"b","args":{}}\n')).toEqual([
      '{"id":2,"cmd":"b","args":{}}',
    ]);
    expect(buffer.pending).toBe("");
  });

  it("skips blank lines", () => {
    const buffer = new LineBuffer();
    expect(buffer.push("\n\n")).toEqual([]);
  });
});

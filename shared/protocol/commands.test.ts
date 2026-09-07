import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  COMMAND_NAMES,
  COMMANDS,
  type CommandName,
  EVENT_NAMES,
  EVENTS,
  isCommandName,
  isEventName,
} from "./commands";
import { PROTOCOL_VERSION } from "./version";

/** The catalog the engine printed, committed by phase 3; `catalog.get` answers with exactly this. */
const golden: unknown = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "engine",
      "tests",
      "golden",
      "catalog.json",
    ),
    "utf8",
  ),
);

/**
 * One valid and one wrong-typed payload per command. The exhaustiveness test below fails if a command
 * is added to the table without an entry here, which is the point: an unexercised schema is a guess.
 */
const cases: Record<CommandName, { valid: unknown; invalid: unknown }> = {
  hello: {
    valid: { protocolVersion: PROTOCOL_VERSION, client: "phasegrid2" },
    invalid: { protocolVersion: "1" },
  },
  "engine.ping": { valid: {}, invalid: 42 },
  "engine.shutdown": { valid: {}, invalid: "now" },
  "catalog.get": { valid: {}, invalid: null },
  "patch.load": {
    valid: { patch: { schemaVersion: 1, modules: [], edges: [] } },
    invalid: { patch: { schemaVersion: 1, modules: {}, edges: [] } },
  },
  "patch.clear": { valid: {}, invalid: [] },
  "patch.batch": {
    valid: { ops: [{ op: "moduleRemove", id: "osc1" }] },
    invalid: { ops: [{ op: "moduleRemove" }] },
  },
  "patch.setVoiceCount": {
    valid: { voiceCount: 8 },
    invalid: { voiceCount: 8.5 },
  },
  "patch.setFeedbackMode": {
    valid: { mode: "block" },
    invalid: { mode: "perSample" },
  },
  "module.add": {
    valid: { id: "osc1", type: "osc.wavetable", params: { level: 0.5 } },
    invalid: { id: "osc1", type: "osc.wavetable", params: { level: "loud" } },
  },
  "module.remove": { valid: { id: "osc1" }, invalid: { id: 1 } },
  "edge.add": {
    valid: {
      id: "e1",
      from: { module: "osc1", port: "out" },
      to: { module: "out1", port: "in" },
    },
    invalid: { id: "e1", from: "osc1:out", to: "out1:in" },
  },
  "edge.remove": { valid: { id: "e1" }, invalid: {} },
  "param.set": {
    valid: { module: "osc1", param: "level", value: 0.25, transient: true },
    invalid: { module: "osc1", param: "level", value: null },
  },
  "transport.play": { valid: {}, invalid: false },
  "transport.stop": { valid: {}, invalid: false },
  "transport.setTempo": { valid: { tempo: 128 }, invalid: { tempo: "128" } },
  "transport.seek": { valid: { ppq: 16 }, invalid: { ppq: -1 } },
  "device.list": { valid: {}, invalid: "all" },
  "device.select": { valid: { id: "" }, invalid: { id: 3 } },
};

describe("command table", () => {
  it("covers every command this phase implements and nothing it does not", () => {
    expect(COMMAND_NAMES).toEqual([
      "hello",
      "engine.ping",
      "engine.shutdown",
      "catalog.get",
      "patch.load",
      "patch.clear",
      "patch.batch",
      "patch.setVoiceCount",
      "patch.setFeedbackMode",
      "module.add",
      "module.remove",
      "edge.add",
      "edge.remove",
      "param.set",
      "transport.play",
      "transport.stop",
      "transport.setTempo",
      "transport.seek",
      "device.list",
      "device.select",
    ]);
    // `midi.*` and `telemetry.*` are later phases; a stub in the table would be a lie.
    for (const name of COMMAND_NAMES) {
      expect(name).not.toMatch(/^(midi|telemetry)\./);
    }
  });

  it("has a valid and an invalid payload exercised for every command", () => {
    expect(Object.keys(cases).sort()).toEqual([...COMMAND_NAMES].sort());
  });

  it("accepts each command's valid arguments", () => {
    for (const name of COMMAND_NAMES) {
      const parsed = COMMANDS[name].args.safeParse(cases[name].valid);
      expect(`${name}: ${parsed.success}`).toBe(`${name}: true`);
    }
  });

  it("rejects each command's wrong-typed arguments", () => {
    for (const name of COMMAND_NAMES) {
      const parsed = COMMANDS[name].args.safeParse(cases[name].invalid);
      expect(`${name}: ${parsed.success}`).toBe(`${name}: false`);
    }
  });

  it("recognises its own names and nothing else", () => {
    expect(isCommandName("patch.batch")).toBe(true);
    expect(isCommandName("midi.list")).toBe(false);
    expect(isCommandName("toString")).toBe(false);
  });
});

describe("command results", () => {
  it("answers catalog.get with the catalog schema itself, not a copy of it", () => {
    expect(COMMANDS["catalog.get"].result.safeParse(golden).success).toBe(true);
  });

  it("describes the handshake, with the telemetry segment absent until phase 5", () => {
    const catalog = golden as { catalogHash: string; conventions: unknown };
    const hello = {
      protocolVersion: PROTOCOL_VERSION,
      engineVersion: "0.1.0",
      catalogHash: catalog.catalogHash,
      conventions: catalog.conventions,
      shm: null,
      capabilities: ["audio", "render"],
    };
    expect(COMMANDS.hello.result.parse(hello).shm).toBeNull();
    expect(
      COMMANDS.hello.result.safeParse({ ...hello, catalogHash: "nope" })
        .success,
    ).toBe(false);
    expect(
      COMMANDS.hello.result.safeParse({
        ...hello,
        shm: { name: "/pg-1", size: 4096, layoutVersion: 1 },
      }).success,
    ).toBe(true);
  });

  it("answers every graph edit with a revision", () => {
    for (const name of [
      "patch.load",
      "patch.clear",
      "patch.batch",
      "patch.setVoiceCount",
      "patch.setFeedbackMode",
      "module.add",
      "module.remove",
      "edge.add",
      "edge.remove",
      "param.set",
    ] as const) {
      expect(COMMANDS[name].result.safeParse({ revision: 3 }).success).toBe(
        true,
      );
      expect(COMMANDS[name].result.safeParse({}).success).toBe(false);
    }
  });

  it("answers every transport command with the same position shape", () => {
    const position = { playing: true, tempo: 120, ppq: 4, samplePos: 96000 };
    for (const name of [
      "transport.play",
      "transport.stop",
      "transport.setTempo",
      "transport.seek",
    ] as const) {
      expect(COMMANDS[name].result.parse(position)).toEqual(position);
    }
    expect(EVENTS["transport.position"].parse(position)).toEqual(position);
  });

  it("lists devices with the backend that owns them", () => {
    const list = {
      devices: [
        { backend: "miniaudio", id: "1", name: "Speakers", isDefault: true },
      ],
      current: "",
      sampleRate: 48000,
      channels: 2,
    };
    expect(COMMANDS["device.list"].result.parse(list)).toEqual(list);
    expect(COMMANDS["device.select"].result.parse(list)).toEqual(list);
    expect(
      COMMANDS["device.list"].result.safeParse({
        ...list,
        devices: [{ id: "1", name: "Speakers", isDefault: true }],
      }).success,
    ).toBe(false);
  });
});

describe("event table", () => {
  it("names the events this phase emits", () => {
    expect(EVENT_NAMES).toEqual([
      "engine.ready",
      "engine.error",
      "engine.log",
      "patch.revision",
      "transport.position",
      "device.changed",
      "engine.connected",
      "engine.crashed",
    ]);
    expect(isEventName("patch.revision")).toBe(true);
    expect(isEventName("midi.noteFeedback")).toBe(false);
  });

  it("types each event's data", () => {
    expect(
      EVENTS["engine.log"].safeParse({ level: "warn", message: "xrun" })
        .success,
    ).toBe(true);
    expect(
      EVENTS["engine.log"].safeParse({ level: "fatal", message: "xrun" })
        .success,
    ).toBe(false);
    expect(EVENTS["engine.connected"].parse({ restarted: true })).toEqual({
      restarted: true,
    });
  });
});

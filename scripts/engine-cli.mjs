#!/usr/bin/env node
// A development client for the engine. Spawns `phasegrid-engine --socket`, connects, and either runs
// the commands given on the argv or reads one JSON command per line from stdin.
//
//   node scripts/engine-cli.mjs hello
//   node scripts/engine-cli.mjs catalog.get '{"detail":"summary"}'
//   node scripts/engine-cli.mjs --demo            # build a synth voice and hold it for a few seconds
//   node scripts/engine-cli.mjs --device null hello   # the silent backend: no hardware, no sound
//   echo '{"cmd":"engine.ping","args":{}}' | node scripts/engine-cli.mjs
//
// This is the manual verification path for the protocol phase. It deliberately uses the same framing
// helper as the real client rather than a private copy, so a framing bug cannot hide here and appear
// only in the application.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { connect } from "node:net";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const enginePath =
  process.env.PHASEGRID_ENGINE_BIN ??
  join(root, "build/engine/phasegrid-engine");
const socketPath = join(
  process.env.TMPDIR ?? "/tmp",
  `pg-cli-${process.pid}.sock`,
);

/**
 * The protocol version, read out of the TypeScript that defines it.
 *
 * This script cannot import a `.ts` module, and hardcoding the number here would give the project two
 * sources of truth that drift apart silently -- the failure would be a handshake refused for a version
 * mismatch that does not really exist. Scraping the constant is ugly, and correct.
 */
function protocolVersion() {
  const source = readFileSync(join(root, "shared/protocol/version.ts"), "utf8");
  const found = /PROTOCOL_VERSION\s*=\s*(\d+)/.exec(source);
  if (found === null)
    die("cannot find PROTOCOL_VERSION in shared/protocol/version.ts");
  return Number(found[1]);
}

/** Same rule as `shared/protocol/envelope.ts`: keep whatever follows the last newline. */
function lineReader(onLine) {
  let carry = "";
  return (chunk) => {
    carry += chunk;
    const parts = carry.split("\n");
    carry = parts.pop() ?? "";
    for (const part of parts) if (part.trim() !== "") onLine(part);
  };
}

function die(message) {
  console.error(message);
  process.exit(1);
}

async function main() {
  const argv = process.argv.slice(2);
  // `--device <id|null>` goes to the engine; everything else is a command for it.
  const engineArgs = ["--socket", socketPath];
  const at = argv.indexOf("--device");
  if (at >= 0 && argv[at + 1] !== undefined) {
    engineArgs.push("--device", argv[at + 1]);
    argv.splice(at, 2);
  }
  const demo = argv[0] === "--demo";

  const engine = spawn(enginePath, engineArgs, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  engine.on("error", (error) =>
    die(`cannot run ${enginePath}: ${error.message}`),
  );
  createInterface({ input: engine.stderr }).on("line", (line) =>
    console.error(`[engine] ${line}`),
  );
  // The engine prints nothing on stdout in socket mode, but if it ever does, seeing it beats losing it.
  createInterface({ input: engine.stdout }).on("line", (line) =>
    console.error(`[engine] ${line}`),
  );

  // The engine opens the audio device before it binds, so the first attempts are expected to fail.
  const socket = await new Promise((resolveSocket) => {
    const attempt = (left) => {
      const s = connect(socketPath);
      s.once("connect", () => resolveSocket(s));
      s.once("error", (error) => {
        s.destroy();
        if (left === 0)
          die(`cannot connect to ${socketPath}: ${error.message}`);
        setTimeout(() => attempt(left - 1), 50);
      });
    };
    attempt(100);
  });
  socket.setEncoding("utf8");

  let nextId = 1;
  const pending = new Map();
  socket.on(
    "data",
    lineReader((line) => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        console.error(`[unparseable] ${line}`);
        return;
      }
      if (message.event !== undefined) {
        // Position arrives twenty times a second and would bury everything else.
        if (message.event !== "transport.position")
          console.error(
            `[event] ${message.event} ${JSON.stringify(message.data)}`,
          );
        return;
      }
      const call = pending.get(message.id);
      if (call === undefined) return;
      pending.delete(message.id);
      call(message);
    }),
  );
  // Trap 4, in miniature: never leave a caller waiting on a socket that has gone.
  socket.on("close", () => {
    for (const call of pending.values())
      call({
        ok: false,
        error: { code: "E_IO", message: "connection closed" },
      });
    pending.clear();
  });

  const call = (cmd, args = {}) =>
    new Promise((resolveCall) => {
      const id = nextId++;
      pending.set(id, resolveCall);
      socket.write(`${JSON.stringify({ id, cmd, args })}\n`);
    });

  const show = async (cmd, args) => {
    const answer = await call(cmd, args);
    if (answer.ok) console.log(`${cmd} -> ${JSON.stringify(answer.result)}`);
    else console.log(`${cmd} !! ${answer.error.code}: ${answer.error.message}`);
    return answer;
  };

  const defaultArgs = (cmd) =>
    cmd === "hello"
      ? { protocolVersion: protocolVersion(), client: "engine-cli" }
      : {};

  if (demo) await runDemo(show, call, defaultArgs);
  else if (argv.length > 0)
    await show(argv[0], argv[1] ? JSON.parse(argv[1]) : defaultArgs(argv[0]));
  else
    for await (const line of createInterface({ input: process.stdin })) {
      if (line.trim() === "") continue;
      const { cmd, args } = JSON.parse(line);
      await show(cmd, args ?? defaultArgs(cmd));
    }

  socket.end();
  // Closing the socket is the shutdown signal; the engine exits on end of stream (trap 3).
  await new Promise((done) => engine.once("exit", done));
}

/** A synth voice built one command at a time, which is the point of the exercise. */
async function runDemo(show, call, defaultArgs) {
  await show("hello", defaultArgs("hello"));
  // The catalog holds every module and every port; report its size rather than printing all of it.
  const catalog = await call("catalog.get", {});
  console.log(
    catalog.ok
      ? `catalog.get -> ${catalog.result.modules.length} modules`
      : `catalog.get !! ${catalog.error.code}: ${catalog.error.message}`,
  );

  await show("patch.clear", {});

  // A clip carries its notes as structured node data rather than as params, because params are numeric.
  // Start and length are in beats; pitch is a MIDI note number. This is a C major arpeggio that repeats.
  const notes = [60, 64, 67, 72].map((pitch, step) => ({
    start: step,
    length: 0.9,
    pitch,
    velocity: 0.8,
  }));

  for (const [id, type, extra] of [
    ["clip", "notes.clip", { params: { length: 4, loop: 1 }, data: { notes } }],
    ["voices", "note.toPoly", {}],
    ["osc", "osc.wavetable", {}],
    // A plucked envelope, so the notes articulate instead of running together: sustain at zero means
    // each note falls away over its decay rather than holding until the gate drops. In seconds, and
    // the oscillator runs through the envelope's own signal path, so there is no amplifier to place.
    [
      "env",
      "env.adsr",
      { params: { attack: 0.005, decay: 0.4, sustain: 0, release: 0.15 } },
    ],
    // Four voices sum into one bus, so unity gain per voice clips. Leave headroom.
    ["out", "io.audioOut", { params: { gain: 0.4 } }],
  ])
    await show("module.add", { id, type, ...extra });

  for (const [from, fromPort, to, toPort] of [
    ["clip", "notes", "voices", "notes"],
    ["voices", "pitch", "osc", "pitch"],
    ["voices", "gate", "env", "gate"],
    ["osc", "out", "env", "signal"],
    ["env", "signal", "out", "inL"],
  ])
    await show("edge.add", {
      id: `${from}.${fromPort}->${to}.${toPort}`,
      from: { module: from, port: fromPort },
      to: { module: to, port: toPort },
    });

  await show("transport.setTempo", { tempo: 96 });
  await show("transport.play", {});
  console.log("playing for 4 seconds...");
  await new Promise((done) => setTimeout(done, 4000));
  await show("transport.stop", {});
}

main().catch((error) => die(error.stack ?? String(error)));

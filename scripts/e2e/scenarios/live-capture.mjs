import { copyFileSync, existsSync, statSync } from "node:fs";
import { measureFile } from "../../audio-measure.mjs";
import { projectDoc, seedProject, until } from "../harness.mjs";

/**
 * The audio the application actually plays, recorded and measured.
 *
 * Every other scenario that listens does so through `engine.render`, which is an offline render of
 * the same patch. That was enough for months and then it was not: the device callback advanced the
 * transport once per callback and every engine block inside it replayed the same musical time, so the
 * live output retriggered every note once per block while every render was clean. This scenario
 * records the device path itself -- the null device here, but the same callback, splitter and clock
 * as a real one -- and asks of the recording what the user asks of the speakers: is it clean, is it a
 * sine, and did the engine's own clock ever skip.
 */
const PATCH = {
  schemaVersion: 1,
  feedbackMode: "sample",
  modules: [
    {
      id: "pat",
      type: "notes.pattern",
      x: 48,
      y: 48,
      params: { cycle: 4, legato: 0.9 },
      data: { pattern: "c3 e3 b3 c4" },
    },
    { id: "voices", type: "note.toPoly", x: 456, y: 48 },
    { id: "osc", type: "osc.sine", x: 600, y: 48 },
    { id: "out", type: "io.audioOut", x: 864, y: 48, params: { gain: 1 } },
  ],
  edges: [
    {
      id: "e1",
      from: { module: "pat", port: "notes" },
      to: { module: "voices", port: "notes" },
    },
    {
      id: "e2",
      from: { module: "voices", port: "pitch" },
      to: { module: "osc", port: "pitch" },
    },
    {
      id: "e3",
      from: { module: "osc", port: "out" },
      to: { module: "out", port: "inL" },
    },
  ],
};

export default {
  name: "live-capture",
  description:
    "record the device's actual output while a pattern plays a sine, and measure the recording: clean, a sine, and no clock skips",
  seed(ws) {
    seedProject(
      ws,
      "live-sine",
      projectDoc({ id: "live-sine", name: "Live sine", patch: PATCH }),
    );
  },
  async run({ evaluate, pg, idle, check }) {
    await evaluate(`openProject("Live sine");`);
    await idle();

    const hello = await pg(
      "engine.call('hello', { protocolVersion: 1, client: 'e2e' })",
    );
    check(
      "the engine can record its output",
      hello.capabilities.includes("capture"),
      JSON.stringify(hello.capabilities),
    );
    check(
      "and says how big its callbacks are",
      Number.isInteger(hello.periodFrames) && hello.periodFrames > 0,
      JSON.stringify({
        periodFrames: hello.periodFrames,
        blockSize: hello.blockSize,
      }),
    );

    await pg('commands.run("transport.play")');
    const root = (await pg("snapshot()")).workspace.root;
    const path = `${root}/live-capture.wav`;
    await pg(
      `engine.call('audio.capture.start', { path: ${JSON.stringify(path)} })`,
    );

    // Two seconds of real time on a real-time-paced device: wait for the file, not for a clock.
    const sampleRate = hello.conventions?.sampleRate ?? 48000;
    const wantBytes = 44 + 2 * sampleRate * 2 * 4;
    await until(() => existsSync(path) && statSync(path).size >= wantBytes, {
      timeoutMs: 15000,
      label: "two seconds of captured audio",
    });
    const stopped = await pg("engine.call('audio.capture.stop', {})");
    check(
      "the capture wrote what it heard",
      stopped.frames >= 2 * sampleRate,
      JSON.stringify(stopped),
    );
    check(
      "without dropping any of it",
      stopped.droppedFrames === 0,
      JSON.stringify(stopped),
    );

    const stats = await pg("engine.call('engine.stats', {})");
    check(
      "the engine's clock never skipped a block while playing",
      stats.clockDiscontinuities === 0,
      JSON.stringify(stats),
    );

    const m = measureFile(path).channels[0];
    check(
      "the recording is a signal",
      m.rms > 0.3,
      JSON.stringify({ rms: m.rms, peak: m.peak }),
    );
    check(
      "and it is clean: no note begins or ends on a step",
      m.maxStep < 0.1,
      `maxStep ${m.maxStep}`,
    );
    check(
      "and the held note is a sine",
      Math.abs(m.crest - Math.SQRT2) < 0.05,
      `crest ${m.crest} at ${m.window.seconds}s, f0 ${m.f0}, THD ${m.thd}%`,
    );
    // For a person: keep the recording somewhere the temp workspace's cleanup will not reach.
    if (process.env.PG_LIVE_CAPTURE_OUT)
      copyFileSync(path, process.env.PG_LIVE_CAPTURE_OUT);
  },
};

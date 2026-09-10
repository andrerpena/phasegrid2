import { projectDoc, seedProject } from "../harness.mjs";

/**
 * Three voices at unity are louder than one, and the output says so.
 *
 * The patch that was "rough again": a pattern through a major Chord into a bare sine. Three full-scale
 * sines sum to three; the device cuts at one. Nothing in the voices, the clock or the oscillator is
 * wrong, and for a while nothing said what was: the float render carried 2.99 faithfully and the
 * driver squared it off in silence. Now the output clips the way the reference instrument's does
 * (Hard at +6 dB by default), the device boundary clamps whatever is still over and counts it, and the
 * Audio Out face wears a meter with a clip light. This scenario checks all three tell the truth, and
 * that turning the output down is the cure it says it is.
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
      data: { pattern: "<c4 eb4> g3*2 [~ bb3] [c4]" },
    },
    { id: "chord", type: "notefx.chord", x: 312, y: 48, params: { chord: 0 } },
    { id: "voices", type: "note.toPoly", x: 456, y: 48 },
    { id: "osc", type: "osc.sine", x: 600, y: 48 },
    { id: "out", type: "io.audioOut", x: 864, y: 48, params: { gain: 1 } },
  ],
  edges: [
    {
      id: "e1",
      from: { module: "pat", port: "notes" },
      to: { module: "chord", port: "notes" },
    },
    {
      id: "e2",
      from: { module: "chord", port: "notes" },
      to: { module: "voices", port: "notes" },
    },
    {
      id: "e3",
      from: { module: "voices", port: "pitch" },
      to: { module: "osc", port: "pitch" },
    },
    {
      id: "e4",
      from: { module: "osc", port: "out" },
      to: { module: "out", port: "inL" },
    },
  ],
};

export default {
  name: "chord-headroom",
  description:
    "a unity triad clips at the output and the output says so: the clamp is counted, the clip light lights, and turning it down cures it",
  seed(ws) {
    seedProject(
      ws,
      "triad",
      projectDoc({ id: "triad", name: "Triad", tempo: 80, patch: PATCH }),
    );
  },
  async run({ evaluate, pg, idle, check, checkEventually }) {
    await evaluate(`openProject("Triad");`);
    await idle();

    // Offline first, through the same path the device takes: the render says how many samples the
    // boundary clamped, and the WAV it produced never holds a sample over one.
    const hot = await pg("engine.render({ seconds: 2 })");
    check(
      "three unity sines ask the device to clamp",
      hot.deviceClips > 0,
      JSON.stringify(hot),
    );
    check(
      "and the render already holds only what a device would play",
      hot.peak[0] <= 1.0001,
      JSON.stringify(hot),
    );

    // The face: the output wears a meter, and after playing the clip light is on.
    await pg('commands.run("transport.play")');
    await checkEventually(
      "the output's face has a meter and its clip light is lit",
      `(() => {
        const meter = window.pg.grid.face("out")?.find((b) => b.kind === "meter");
        return meter !== undefined && meter.level?.clipped?.some(Boolean) === true;
      })()`,
    );
    const stats = await pg("engine.call('engine.stats', {})");
    check(
      "and the engine counted the clamp live",
      stats.deviceClips > 0,
      JSON.stringify(stats),
    );
    await pg('commands.run("transport.stop")');

    // The cure is level. At 0.3 the same triad fits with room to spare, and nothing clamps.
    await pg('patch.setParam("out", "gain", 0.3)');
    await idle();
    const cool = await pg("engine.render({ seconds: 2 })");
    check(
      "turned down, the triad fits",
      cool.deviceClips === 0 && cool.peak[0] < 1,
      JSON.stringify(cool),
    );
    check(
      "and it is three clean sines",
      cool.maxStep[0] < 0.1,
      JSON.stringify(cool),
    );
  },
};

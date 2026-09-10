import { projectDoc, seedProject } from "../harness.mjs";

/**
 * When a released voice ends, and how it ends. The patch that found both: single notes into a converter,
 * a sine that never goes quiet on its own, and the output. With nothing to hold a voice past its note it
 * plays one voice, note after note, and the output never rises above one sine. The same patch with the
 * output asked to affect voice lifetime keeps every released voice alive for as long as it hears it --
 * which, for a sine, is forever -- so the notes pile up: the drone, but chosen.
 *
 * The level checks alone would pass on a signal made entirely of clicks, which is exactly what this
 * patch used to be: every note began on a step to the bottom of the wave and ended on a step to zero.
 * `maxStep` is what hears that. A sine at these pitches moves by hundredths from one sample to the next,
 * so anything approaching full scale is a discontinuity rather than a wave.
 */
const sinePatch = (outParams) => ({
  schemaVersion: 1,
  feedbackMode: "sample",
  modules: [
    {
      id: "pat",
      type: "notes.pattern",
      x: 48,
      y: 48,
      params: { cycle: 4, legato: 0.9 },
    },
    { id: "voices", type: "note.toPoly", x: 456, y: 48 },
    { id: "osc", type: "osc.sine", x: 600, y: 48 },
    { id: "out", type: "io.audioOut", x: 864, y: 48, params: outParams },
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
});

export default {
  name: "voice-lifetime",
  description:
    "a bare sine ends with its note and a run of notes plays one voice; with the output holding voices the notes pile up",
  seed(ws) {
    seedProject(
      ws,
      "sine-run",
      projectDoc({
        id: "sine-run",
        name: "Sine run",
        patch: sinePatch({ gain: 1 }),
      }),
    );
    seedProject(
      ws,
      "sine-held",
      projectDoc({
        id: "sine-held",
        name: "Sine held",
        patch: sinePatch({ gain: 1, lifetime: 1 }),
      }),
    );
  },
  async run({ evaluate, pg, idle, check }) {
    await evaluate(`openProject("Sine run");`);
    await idle();
    await pg('commands.run("transport.play")');
    // Four notes a cycle, three seconds: a dozen notes. One voice at a time is one sine, peak 1.
    const run = await pg("engine.render({ seconds: 3 })");
    check("the run of notes is heard", run.rms[0] > 0.3, JSON.stringify(run));
    check(
      "and never louder than one sine: each released voice ended with its note",
      run.peak[0] < 1.05,
      JSON.stringify(run),
    );
    check(
      "and no note begins or ends on a step: the voices ramp in and out",
      run.maxStep[0] < 0.1,
      JSON.stringify(run),
    );

    await evaluate(`openProject("Sine held");`);
    await idle();
    const held = await pg("engine.render({ seconds: 3 })");
    check(
      "with the output affecting voice lifetime the released voices stay and the notes stack up",
      held.peak[0] > 1.5,
      JSON.stringify(held),
    );
  },
};

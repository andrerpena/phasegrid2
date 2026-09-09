import { projectDoc, seedProject } from "../harness.mjs";

/**
 * Knobs turning under modulation, as many of them as have a cable: an LFO into two knobs of another
 * LFO turns both, and pulling one cable rests that knob while the other keeps turning.
 *
 * The engine publishes every parameter of a watched module, so the second cable changes nothing it
 * has to be told; the interface has to notice on its own which knobs to drive from what it reads.
 */
const PATCH = {
  schemaVersion: 1,
  voiceCount: 1,
  feedbackMode: "sample",
  modules: [
    { id: "lfo", type: "mod.lfo", x: 48, y: 48, params: { rate: 8 } },
    { id: "target", type: "mod.lfo", x: 48, y: 192 },
    { id: "sine", type: "osc.sine", x: 336, y: 48 },
    { id: "out", type: "io.audioOut", x: 600, y: 48 },
  ],
  edges: [
    {
      id: "e1",
      from: { module: "sine", port: "out" },
      to: { module: "out", port: "inL" },
    },
    {
      id: "e2",
      from: { module: "lfo", port: "out" },
      to: { module: "target", port: "param:shape" },
    },
  ],
};

/**
 * Whether a knob's live value moved since this was last asked: an expression for `checkEventually`,
 * which polls it until it is true. Null never counts as turning, and the first non-null reading
 * counts, so asking twice is what proves a value that changes rather than one stuck reading.
 */
const turning = (module, param) => {
  const key = JSON.stringify(`${module}.${param}`);
  const args = `${JSON.stringify(module)}, ${JSON.stringify(param)}`;
  return `(() => {
    const last = (window.__pgKnobs ??= {});
    const now = window.pg.grid.knob(${args})?.live;
    if (now === null || now === undefined || now === last[${key}]) return false;
    last[${key}] = now;
    return true;
  })()`;
};

export default {
  name: "modulation-live",
  description:
    "two knobs on one module both turn under modulation, and one rests when its cable is pulled",
  seed(ws) {
    seedProject(
      ws,
      "modulation-live",
      projectDoc({ id: "modulation-live", name: "Modulation", patch: PATCH }),
    );
  },
  async run({ evaluate, pg, idle, checkEventually, screenshot, check }) {
    await evaluate(`click("button", "Modulation");`);
    await idle();
    // A project opens stopped, and a held patch has nothing live: the knobs rest where they are set.
    await pg('commands.run("transport.play")');
    await idle();

    // One cable: the knob it lands on turns, its neighbour rests.
    await checkEventually(
      "the shape knob turns under the LFO",
      turning("target", "shape"),
    );
    await checkEventually(
      "and turns again: a moving value, not one stuck reading",
      turning("target", "shape"),
    );
    const depthBefore = await pg('grid.knob("target", "depth")');
    check(
      "the depth knob, with nothing in its socket, is not live",
      depthBefore?.live === null,
      JSON.stringify(depthBefore),
    );

    // A second cable into the same module: both knobs turn.
    const id = await pg(
      'patch.connect({ module: "lfo", port: "out" }, { module: "target", port: "param:depth" })',
    );
    await idle();
    await checkEventually(
      "with a second cable the depth knob turns too",
      turning("target", "depth"),
    );
    await checkEventually("and keeps turning", turning("target", "depth"));
    await checkEventually(
      "while the shape knob still turns",
      turning("target", "shape"),
    );
    await screenshot("modulation-live-two");

    // Pull the second cable: its knob rests where the document has it, the other keeps turning.
    await pg(
      `patch.apply([{ op: "edgeRemove", id: ${JSON.stringify(id)} }], "Disconnect")`,
    );
    await idle();
    await checkEventually(
      "with its cable pulled the depth knob rests",
      'window.pg.grid.knob("target", "depth")?.live === null',
    );
    await idle();
    const depthAfter = await pg('grid.knob("target", "depth")');
    check(
      "and stays resting a frame later",
      depthAfter?.live === null,
      JSON.stringify(depthAfter),
    );
    await checkEventually(
      "while the shape knob still turns",
      turning("target", "shape"),
    );
    await screenshot("modulation-live-one");
  },
};

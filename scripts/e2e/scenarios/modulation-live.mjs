import { projectDoc, seedProject } from "../harness.mjs";

/**
 * Knobs turning under modulation, as many of them as have a cable: an LFO into two knobs of another
 * LFO turns both, and pulling one cable rests that knob while the other keeps turning.
 *
 * The engine publishes every parameter of a watched module, so the second cable changes nothing it
 * has to be told; the interface has to notice on its own which knobs to drive from what it reads.
 *
 * And a module that draws a picture of itself is watched on two channels at once: the pattern's
 * Legato turns under its cable while its piano roll keeps drawing. With one slot per module the
 * picture took it and the knob never moved, which is the bug the channels exist for.
 */
const PATCH = {
  schemaVersion: 1,
  voiceCount: 1,
  feedbackMode: "sample",
  modules: [
    { id: "lfo", type: "mod.lfo", x: 48, y: 48, params: { rate: 8 } },
    { id: "pattern", type: "notes.pattern", x: 48, y: 288 },
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
    {
      id: "e3",
      from: { module: "lfo", port: "out" },
      to: { module: "pattern", port: "param:legato" },
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

/**
 * Whether a module's piano roll has drawn again since this was last asked: the engine numbers every
 * publish, so a moving index is the display channel still arriving. Same shape as `turning`.
 */
const drawing = (module) => {
  const key = JSON.stringify(`${module}.pianoRoll`);
  const arg = JSON.stringify(module);
  return `(() => {
    const last = (window.__pgRolls ??= {});
    const roll = window.pg.grid.face(${arg})?.find((b) => b.kind === "pianoRoll");
    const now = roll?.notes?.index;
    if (now === null || now === undefined || now === last[${key}]) return false;
    last[${key}] = now;
    return true;
  })()`;
};

export default {
  name: "modulation-live",
  description:
    "two knobs on one module both turn under modulation, one rests when its cable is pulled, and a " +
    "module that draws itself turns its knob while it draws",
  seed(ws) {
    seedProject(
      ws,
      "modulation-live",
      projectDoc({ id: "modulation-live", name: "Modulation", patch: PATCH }),
    );
  },
  async run({ evaluate, pg, idle, checkEventually, screenshot, check }) {
    await evaluate(`openProject("Modulation");`);
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

    // A module that publishes a picture of its own: the knob and the picture are two channels, and
    // asking for one must not cost the other.
    await checkEventually(
      "the pattern's legato knob turns under the LFO",
      turning("pattern", "legato"),
    );
    await checkEventually(
      "and turns again, so it is a moving value",
      turning("pattern", "legato"),
    );
    await checkEventually(
      "while its piano roll keeps drawing",
      drawing("pattern"),
    );
    await checkEventually("and draws again", drawing("pattern"));
    await screenshot("modulation-live-pattern");
  },
};

import { projectDoc, seedProject } from "../harness.mjs";

/**
 * The reverb, end to end: the face the engine declared, and the controls doing on the canvas what
 * they claim to do.
 *
 * The parameter check is the one worth driving an app for. `fx.reverb` is the Surge Synth Team's
 * Reverb 2, and its descriptor is GENERATED from the effect's own metadata rather than written out
 * by hand (docs/adrs/0010). So this asserts what that generation is for: Decay Time reaching the
 * page as seconds on a logarithmic taper, over the range the effect itself describes -- the thing
 * that was wrong on every vendored-adapter module before it, where a knob labelled "seconds" carried
 * a raw pre-scale number.
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
      params: { legato: 0.3, cycle: 4 },
      data: { pattern: "c3 e3 g3 b3" },
    },
    { id: "poly", type: "note.toPoly", x: 336, y: 48, params: { voices: 8 } },
    { id: "osc", type: "osc.sawtooth", x: 528, y: 48 },
    {
      id: "env",
      type: "env.adsr",
      x: 528,
      y: 216,
      params: { attack: 0.001, decay: 0.15, sustain: 0, release: 0.05 },
    },
    { id: "sum", type: "voices.sum", x: 840, y: 216 },
    {
      id: "verb",
      type: "fx.reverb",
      x: 1032,
      y: 216,
      params: { mix: 100, decay_time: 2 },
    },
    { id: "out", type: "io.audioOut", x: 1560, y: 216 },
  ],
  edges: [
    {
      id: "e1",
      from: { module: "pat", port: "notes" },
      to: { module: "poly", port: "notes" },
    },
    {
      id: "e2",
      from: { module: "poly", port: "pitch" },
      to: { module: "osc", port: "pitch" },
    },
    {
      id: "e3",
      from: { module: "poly", port: "gate" },
      to: { module: "env", port: "gate" },
    },
    {
      id: "e4",
      from: { module: "osc", port: "out" },
      to: { module: "env", port: "signal" },
    },
    {
      id: "e5",
      from: { module: "env", port: "signal" },
      to: { module: "sum", port: "in" },
    },
    {
      id: "e6",
      from: { module: "sum", port: "out" },
      to: { module: "verb", port: "in" },
    },
    {
      id: "e7",
      from: { module: "verb", port: "out" },
      to: { module: "out", port: "inL" },
    },
    {
      id: "e8",
      from: { module: "verb", port: "out" },
      to: { module: "out", port: "inR" },
    },
  ],
};

export default {
  name: "reverb",
  description:
    "the reverb's controls are generated from the effect's own metadata, reach the page in real units, and change the sound",
  seed(ws) {
    seedProject(
      ws,
      "reverb",
      projectDoc({ id: "reverb", name: "Reverb", patch: PATCH }),
    );
  },
  async run({ evaluate, pg, idle, check, screenshot }) {
    await evaluate(`openProject("Reverb");`);
    await idle();
    await evaluate(
      `document.querySelector('button[aria-label="Zoom to fit"]').click();`,
    );
    await idle();

    // ── The face the engine declared ────────────────────────────────────────
    const face = await pg('grid.face("verb")');
    const kinds = (k) => face.filter((b) => b.kind === k).map((b) => b.name);
    check(
      "the reverb wears its ten controls and its two jacks",
      face !== null &&
        kinds("knob").length === 10 &&
        kinds("jack").join(" ") === "in out",
      JSON.stringify(face?.map((b) => `${b.kind}:${b.name}`)),
    );
    // The ids are generated from the effect's parameter names, and the face names them, so a face
    // that draws these is a face whose generation and whose layout agree.
    check(
      "and the controls are the effect's own, by the names it gives them",
      ["decay_time", "room_size", "diffusion", "mix"].every((id) =>
        kinds("knob").includes(id),
      ),
      JSON.stringify(kinds("knob")),
    );
    await screenshot("reverb-face");

    // ── Reverb Time is in seconds, on its own taper ─────────────────────────
    // The knob a drag lands on is the param's own curve, and Reverb Time is logarithmic, so its
    // middle is the geometric mean of its ends rather than the arithmetic one. That is what stopped
    // the old control -- a linear -6..6 that meant a power of two in seconds -- from being dialable.
    const time = await evaluate(
      `const d = window.pg.stores.catalog.getState().byId.get("fx.reverb");
       return d.params.find((x) => x.id === "decay_time");`,
    );
    check(
      "Decay Time is seconds on a log taper, generated from the effect's own metadata",
      time.unit === "seconds" &&
        time.curve === "log" &&
        time.min > 0 &&
        time.min < 0.1 &&
        time.max > 32,
      JSON.stringify(time),
    );

    // ── It plays, and it reverberates ───────────────────────────────────────
    await pg('commands.run("transport.play")');
    await idle();
    await screenshot("reverb-playing");

    // Decay Time is the control the module exists for, and a longer one has to leave more sound in
    // the room. Rendered rather than metered, because what is being compared is two settings.
    const short = await pg("engine.render({ seconds: 4 })");
    await pg('patch.setParam("verb", "decay_time", 32)');
    await idle();
    const long = await pg("engine.render({ seconds: 4 })");
    check(
      "a longer Decay Time leaves more sound behind",
      short.rms[0] > 0.005 && long.rms[0] > short.rms[0],
      `2 s rms ${short.rms[0]}, 32 s rms ${long.rms[0]}`,
    );

    // ── Mix is what changes the level ───────────────────────────────────────
    await pg('patch.setParam("verb", "decay_time", 2)');
    await pg('patch.setParam("verb", "mix", 0)');
    await idle();
    const dry = await pg("engine.render({ seconds: 2 })");
    await pg('patch.setParam("verb", "mix", 100)');
    await idle();
    const wet = await pg("engine.render({ seconds: 2 })");
    check(
      "Mix 0 is the dry signal and Mix 100 is the reverb, and they are not the same sound",
      dry.rms[0] > 0.01 &&
        wet.rms[0] > 0.01 &&
        Math.abs(dry.rms[0] - wet.rms[0]) > 0.005,
      `dry ${dry.rms[0]}, wet ${wet.rms[0]}`,
    );
    await pg('commands.run("transport.stop")');
  },
};

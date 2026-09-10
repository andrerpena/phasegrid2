import { projectDoc, seedProject } from "../harness.mjs";

/**
 * The reverb, end to end: the face the engine declared, the meter on it reading what the module
 * actually sends, and the two knobs that used to be the problem -- Reverb Time, which is now in
 * seconds and does not change the level, and Mix, which does.
 *
 * The level check is the one worth driving an app for. `fx.reverb` was rewritten because the
 * vendored network's wet level rose with its decay time and ran the output into the clipper
 * (docs/adrs/0009); here the longest tail on the knob is asked for while the patch plays, and the
 * meter has to keep reading the same level and stay unclipped.
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
      params: { mix: 100, time: 1.26 },
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

const METER = 'window.pg.grid.face("verb")?.find((b) => b.kind === "meter")';

export default {
  name: "reverb",
  description:
    "the reverb wears the reference instrument's controls, its meter reads what it sends, and Reverb Time changes the tail without changing the level",
  seed(ws) {
    seedProject(
      ws,
      "reverb",
      projectDoc({ id: "reverb", name: "Reverb", patch: PATCH }),
    );
  },
  async run({ evaluate, pg, idle, checkEventually, check, screenshot }) {
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
      "the reverb wears the reference's thirteen controls, a mode switch, a meter and its two jacks",
      face !== null &&
        kinds("knob").length === 12 &&
        kinds("select").join(" ") === "mode" &&
        kinds("meter").length === 1 &&
        kinds("jack").join(" ") === "in out",
      JSON.stringify(face?.map((b) => `${b.kind}:${b.name}`)),
    );
    // The two Modulation controls are past the reference's panel, so they are in the inspector and
    // not on the face -- which is the rule the face is there to state.
    check(
      "and keeps the modulation controls off it",
      !kinds("knob").includes("mod_amount") &&
        !kinds("knob").includes("mod_rate"),
      JSON.stringify(kinds("knob")),
    );
    check(
      "nothing has been metered before the patch plays",
      face.find((b) => b.kind === "meter").level === null,
    );
    await screenshot("reverb-face");

    // ── Reverb Time is in seconds, on its own taper ─────────────────────────
    // The knob a drag lands on is the param's own curve, and Reverb Time is logarithmic, so its
    // middle is the geometric mean of its ends rather than the arithmetic one. That is what stopped
    // the old control -- a linear -6..6 that meant a power of two in seconds -- from being dialable.
    const time = await evaluate(
      `const d = window.pg.stores.catalog.getState().byId.get("fx.reverb");
       return d.params.find((x) => x.id === "time");`,
    );
    check(
      "Reverb Time is seconds on a log taper, over the reference's own range",
      time.unit === "seconds" &&
        time.curve === "log" &&
        Math.abs(time.min - 0.316) < 0.001 &&
        Math.abs(time.max - 31.6) < 0.01,
      JSON.stringify(time),
    );

    // ── The meter, while it plays ───────────────────────────────────────────
    await pg('commands.run("transport.play")');
    await idle();
    await checkEventually(
      "the meter reads a level on both channels without clipping",
      `(() => {
        const l = ${METER}?.level;
        return l != null && l.peak.length === 2 && l.peak.every((p) => p > 0.05 && p < 1) &&
          l.clipped.every((c) => c === false);
      })()`,
      { timeoutMs: 15000 },
    );
    await screenshot("reverb-playing");

    // ── The tail is longer, the level is not ────────────────────────────────
    // A hundred times the reverb time. On the vendored network this was +18.5 dB and over the top;
    // here the tank's input is scaled back by the same law that made it grow.
    const short = await pg("engine.render({ seconds: 4 })");
    await pg('patch.setParam("verb", "time", 31.6)');
    await idle();
    const long = await pg("engine.render({ seconds: 4 })");
    const ratio = long.rms[0] / short.rms[0];
    check(
      "a hundredfold reverb time leaves the level where it was",
      short.rms[0] > 0.01 && ratio > 0.5 && ratio < 2,
      `0.316 s rms ${short.rms[0]}, 31.6 s rms ${long.rms[0]}`,
    );
    await checkEventually(
      "and the meter still says it is not clipping",
      `(() => {
        const l = ${METER}?.level;
        return l != null && l.clipped.every((c) => c === false) && l.peak.every((p) => p < 1);
      })()`,
      { timeoutMs: 15000 },
    );

    // ── Mix is what changes the level ───────────────────────────────────────
    await pg('patch.setParam("verb", "time", 1.26)');
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

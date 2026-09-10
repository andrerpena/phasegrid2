import { projectDoc, seedProject } from "../harness.mjs";

/**
 * The envelope, end to end: its picture follows its knobs while nothing is playing, its playhead
 * travels while a note sounds, and its model switch cycles under a real click.
 *
 * The picture is the part worth driving an app for. It is computed by the module that makes the
 * sound and published on the preview channel, which is what lets it keep following a knob turned
 * while the patch is HELD -- so the first half of this runs before Play, deliberately.
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
      params: { legato: 0.9, cycle: 4 },
      data: { pattern: "c3 e3 b3 c4" },
    },
    { id: "poly", type: "note.toPoly", x: 336, y: 48, params: { voices: 8 } },
    { id: "osc", type: "osc.sine", x: 528, y: 48 },
    {
      id: "env",
      type: "env.adsr",
      x: 528,
      y: 216,
      params: { attack: 0.05, decay: 0.4, sustain: 50, release: 0.2 },
    },
    { id: "out", type: "io.audioOut", x: 840, y: 216 },
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
      to: { module: "out", port: "inL" },
    },
  ],
};

/** The picture on the envelope's face, as the page sees it. */
const PICTURE =
  'window.pg.grid.face("env")?.find((b) => b.kind === "adsr")?.envelope';

export default {
  name: "envelope",
  description:
    "the envelope's picture follows its knobs while held, its playhead moves while a note sounds, and its model switch cycles",
  seed(ws) {
    seedProject(
      ws,
      "envelope",
      projectDoc({ id: "envelope", name: "Envelope", patch: PATCH }),
    );
  },
  async run({
    evaluate,
    pg,
    idle,
    checkEventually,
    clickAt,
    screenshot,
    check,
  }) {
    await evaluate(`openProject("Envelope");`);
    await idle();
    await evaluate(
      `document.querySelector('button[aria-label="Zoom to fit"]').click();`,
    );
    await idle();

    // ── The face the engine declared ────────────────────────────────────────
    const face = await pg('grid.face("env")');
    check(
      "the envelope wears a picture, a switch, four knobs and five jacks",
      face !== null &&
        face.filter((b) => b.kind === "adsr").length === 1 &&
        face.filter((b) => b.kind === "select").length === 1 &&
        face.filter((b) => b.kind === "knob").length === 4 &&
        face.filter((b) => b.kind === "jack").length === 5,
      JSON.stringify(face?.map((b) => `${b.kind}:${b.name}`)),
    );

    // ── The picture, before anything plays ──────────────────────────────────
    // A held patch runs no module, so this is the case a display-channel picture would fail: the
    // shape has to be drawn from what the document says and follow a knob turned in the silence.
    await checkEventually(
      "the picture is drawn before Play, with its stages in the order they happen",
      `(() => {
        const e = ${PICTURE};
        return e != null && e.playhead === null &&
          0 < e.attackEnd && e.attackEnd < e.decayEnd && e.decayEnd < e.sustainEnd &&
          e.sustainEnd < 1 && Math.abs(e.sustain - 0.5) < 0.01;
      })()`,
    );
    await screenshot("envelope-shape");
    const before = await pg(PICTURE.replace("window.pg.", ""));

    // A longer attack takes a larger share of the width: the picture is the settings, not a template.
    await pg('patch.setParam("env", "attack", 2)');
    await idle();
    await checkEventually(
      "turning Attack while nothing plays widens the attack on the picture",
      `(() => {
        const e = ${PICTURE};
        return e != null && e.attackEnd > ${before.attackEnd} * 2;
      })()`,
    );
    await pg('patch.setParam("env", "attack", 0.05)');
    await idle();

    // ── The playhead, while a note sounds ───────────────────────────────────
    await pg('commands.run("transport.play")');
    await idle();
    await checkEventually(
      "a note puts the playhead on the picture",
      `(() => {
        const e = ${PICTURE};
        return e?.playhead != null && e.playhead.x >= 0 && e.playhead.x <= 1;
      })()`,
    );
    // And it travels: two reads a moment apart that are never different would be a frozen picture.
    await evaluate(
      `window.__envPositions = [];
       window.__envWatch = setInterval(() => {
         const e = ${PICTURE};
         if (e?.playhead != null) window.__envPositions.push(e.playhead.x);
       }, 40);`,
    );
    await checkEventually(
      "and it travels along it as the note plays",
      `(() => {
        const seen = window.__envPositions ?? [];
        return seen.length > 5 && new Set(seen.map((x) => x.toFixed(3))).size > 3;
      })()`,
      { timeoutMs: 8000 },
    );
    await evaluate(`clearInterval(window.__envWatch);`);
    await screenshot("envelope-playing");

    // The patch really is making sound through the envelope's own signal path -- no VCA anywhere.
    const rendered = await pg("engine.render({ seconds: 2 })");
    check(
      "the envelope's signal output is what the patch is playing",
      rendered.rms[0] > 0.02 && rendered.maxStep[0] < 0.1,
      JSON.stringify(rendered),
    );

    // ── With no gate cable at all ───────────────────────────────────────────
    // The patch anyone builds first. Nothing on the module says a cable is missing, so an envelope
    // that stayed shut would make the whole thing silent and give no clue why; inside an instrument
    // the voice pool already knows which voices hold a note, so it follows them.
    await pg(
      `patch.apply([{ op: "edgeRemove", id: "e3" }], "unplug the gate")`,
    );
    await idle();
    const gateless = await pg("engine.render({ seconds: 2 })");
    check(
      "an envelope with nothing in its Gate follows the notes rather than falling silent",
      gateless.rms[0] > 0.02 && gateless.maxStep[0] < 0.1,
      JSON.stringify(gateless),
    );
    await checkEventually(
      "and its playhead still travels",
      `(() => {
        const e = ${PICTURE};
        return e?.playhead != null;
      })()`,
    );
    await pg('commands.run("edit.undo")');
    await idle();

    // ── The model switch, under a real pointer ──────────────────────────────
    await pg('commands.run("transport.stop")');
    await idle();
    const model = (await pg('grid.face("env")')).find(
      (b) => b.kind === "select",
    );
    check(
      "the switch shows the model it is set to",
      model?.choice?.value === 0 && model.choice.label === "A",
      JSON.stringify(model),
    );
    await clickAt(
      model.rect.x + model.rect.width / 2,
      model.rect.y + model.rect.height / 2,
    );
    await idle();
    await checkEventually(
      "clicking it steps to the next model, in the document and on the face",
      `(() => {
        const b = window.pg.grid.face("env")?.find((x) => x.kind === "select");
        const doc = window.pg.snapshot().patch.modules.find((m) => m.id === "env");
        return b?.choice?.value === 1 && b.choice.label === "R" && doc?.params?.model === 1;
      })()`,
    );
    await pg('commands.run("edit.undo")');
    await idle();
    await checkEventually(
      "and undo steps it back, because it is an ordinary edit",
      `window.pg.grid.face("env")?.find((x) => x.kind === "select")?.choice?.value === 0`,
    );
    await screenshot("envelope-model");
  },
};

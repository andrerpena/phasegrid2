import { projectDoc, seedProject } from "../harness.mjs";

/**
 * A keyboard on a module's face lighting the keys the voices are playing. The whole path in one
 * assertion -- the engine's Keys slot, the subscription, the block -- with the exact notes of the
 * chord rather than "something lit"; and the keyboard reshaping when its range is turned.
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
      params: { cycle: 4, legato: 1 },
      data: { pattern: "[c4,e4,g4]" },
    },
    { id: "voices", type: "note.toPoly", x: 312, y: 48 },
    { id: "piano", type: "display.piano", x: 456, y: 48 },
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
      to: { module: "piano", port: "pitch" },
    },
    {
      id: "e3",
      from: { module: "voices", port: "gate" },
      to: { module: "piano", port: "gate" },
    },
  ],
};

/** The keyboard block on the module's face, from the page. */
const BLOCK = 'window.pg.grid.face("piano")?.find((b) => b.kind === "piano")';

export default {
  name: "piano",
  description:
    "a keyboard lights the keys the voices are playing, follows an edit to the source under a held chord, and reshapes when its range is turned",
  seed(ws) {
    seedProject(
      ws,
      "piano",
      projectDoc({ id: "piano", name: "Keyboard", patch: PATCH }),
    );
  },
  async run({ evaluate, pg, idle, checkEventually, screenshot, check }) {
    await evaluate(`openProject("Keyboard");`);
    await idle();

    const face = await pg('grid.face("piano")');
    check(
      "the piano's face is its two inputs, the keys and the octave knob",
      Array.isArray(face) &&
        face.map((b) => `${b.kind}:${b.name}`).join(" ") ===
          "title:title jack:pitch piano:piano knob:octaves jack:gate",
      JSON.stringify(face?.map((b) => `${b.kind}:${b.name}`)),
    );
    const keys = face?.find((b) => b.kind === "piano");
    check(
      "nothing is lit before the patch plays, and the range is the module's defaults",
      keys?.keys === null &&
        keys?.range?.low === 3 &&
        keys?.range?.octaves === 2,
      JSON.stringify(keys),
    );

    await pg('commands.run("transport.play")');
    await idle();
    await checkEventually(
      "the chord lights exactly its three keys",
      `(${BLOCK})?.keys?.held?.join() === "60,64,67"`,
    );
    await screenshot("piano-chord");

    // Editing the pattern rebuilds the source under the held chord. The old instance's notes must be
    // released by the new one, or the converter holds their voices and the keys stay lit for ever.
    await pg(
      'patch.apply([{ op: "moduleSetData", id: "pat", data: { pattern: "[d4,f4,a4]", velocity: "" } }], "Edit pattern")',
    );
    await idle();
    await checkEventually(
      "editing the chord while it sounds moves the lit keys, and none stays stuck",
      `(${BLOCK})?.keys?.held?.join() === "62,65,69"`,
    );
    await screenshot("piano-edited-chord");

    // The range is the document's: turning the knob reshapes the keys without the engine's help.
    await pg('patch.setParam("piano", "octaves", 4)');
    await pg('patch.setParam("piano", "low", 2)');
    await idle();
    await checkEventually(
      "turning Octaves and Low reshapes the keyboard",
      `(() => { const r = (${BLOCK})?.range; return r?.octaves === 4 && r?.low === 2; })()`,
    );
    await screenshot("piano-four-octaves");
  },
};

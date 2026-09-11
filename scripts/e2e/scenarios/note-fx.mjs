import { projectDoc, seedProject } from "../harness.mjs";

/**
 * The note effects: modules with a note stream in and a different one out, in their own group in
 * the catalogue beside the audio effects. A pattern through a chord module into the voices is heard;
 * the project's scale reaches the engine, which is what the quantizer reads; and the two declared
 * faces draw block by block. And the point of instruments: the chord plays polyphonically in a project
 * that never set a voice count, because the converter owns its voices.
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
      data: { pattern: "c3 eb3 g3 bb3" },
    },
    { id: "chord", type: "notefx.chord", x: 312, y: 48, params: { chord: 1 } },
    { id: "voices", type: "note.toPoly", x: 456, y: 48 },
    { id: "osc", type: "osc.sawtooth", x: 600, y: 48 },
    { id: "out", type: "io.audioOut", x: 864, y: 48, params: { gain: 0.3 } },
    { id: "piano", type: "display.piano", x: 600, y: 200 },
    { id: "arp", type: "notefx.arp", x: 48, y: 336 },
    { id: "human", type: "notefx.humanize", x: 312, y: 336 },
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
    {
      id: "e5",
      from: { module: "voices", port: "pitch" },
      to: { module: "piano", port: "pitch" },
    },
  ],
};

export default {
  name: "note-fx",
  description:
    "note effects in their own catalogue group, a chord heard through the voices, the project's scale on the transport, and the declared faces drawn",
  seed(ws) {
    seedProject(
      ws,
      "note-fx",
      projectDoc({ id: "note-fx", name: "Note effects", patch: PATCH }),
    );
  },
  async run({ evaluate, pg, idle, checkEventually, screenshot, check }) {
    await evaluate(`openProject("Note effects");`);
    await idle();

    // ── The catalogue: two effect groups, titled as the engine titles them ──
    const catalog = await pg("engine.call('catalog.get', {})");
    const inGroup = (category) =>
      catalog.modules
        .filter((m) => m.category === category)
        .map((m) => m.id)
        .sort();
    check(
      "the audio effects sit under Audio FX",
      inGroup("Audio FX").join(" ") ===
        "fx.bonsai fx.chorus fx.compressor fx.delay fx.delay.floaty fx.distortion " +
          "fx.eq fx.flanger fx.phaser fx.reverb fx.reverb.hall fx.rotary",
      JSON.stringify(inGroup("Audio FX")),
    );
    check(
      "and the note effects under Note FX",
      inGroup("Note FX").join(" ") ===
        "notefx.arp notefx.chord notefx.humanize notefx.quantize",
      JSON.stringify(inGroup("Note FX")),
    );
    check(
      "every note effect takes notes and gives notes",
      catalog.modules
        .filter((m) => m.category === "Note FX")
        .every(
          (m) =>
            m.inputs.find((p) => p.id === "notes")?.role === "note" &&
            m.outputs.find((p) => p.id === "notes")?.role === "note",
        ),
    );
    check(
      "no category is a slug any more",
      catalog.modules.every((m) => /^[A-Z]/.test(m.category)),
      JSON.stringify([...new Set(catalog.modules.map((m) => m.category))]),
    );

    // ── A chord is heard ──
    await pg('commands.run("transport.play")');
    const sound = await pg("engine.render({ seconds: 0.5 })");
    check(
      "a pattern through the chord module is audible",
      sound.rms[0] > 0.02,
      JSON.stringify(sound),
    );

    // ── The chord plays as a chord with no voice count set anywhere: the converter's own pool ──
    await checkEventually(
      "the chord lights three keys on the piano, one voice each",
      `(() => {
        const held = window.pg.grid.face("piano")?.find((b) => b.kind === "piano")?.keys?.held;
        return Array.isArray(held) && held.length === 3 && held[1] - held[0] === 3 && held[2] - held[0] === 7;
      })()`,
    );
    // The compiler says which modules run per voice: the oscillator does, the pattern does not.
    const domains = await pg("stores.engine.getState().domains");
    check(
      "the engine reports the oscillator inside the converter's instrument and the pattern as global",
      domains.osc?.instrument === "voices" &&
        domains.pat === "global" &&
        domains.out?.instrument === "voices",
      JSON.stringify(domains),
    );

    // ── The project's scale reaches the engine ──
    await pg('stores.project.getState().setScale({ root: 2, name: "major" })');
    await checkEventually(
      "the transport carries D major once the project is set to it",
      async () => {
        // Any transport answer reports the scale; setting the tempo to what it is changes nothing.
        const tempo = (await pg("stores.project.getState().active()")).tempo;
        const position = await pg(
          `engine.call('transport.setTempo', { tempo: ${tempo} })`,
        );
        return (
          position.scaleRoot === 2 &&
          position.scaleIntervals.join() === "0,2,4,5,7,9,11"
        );
      },
    );

    // ── The declared faces ──
    for (const [id, expected] of [
      ["arp", "title:title jack:notes knob:octaves knob:gate jack:notes"],
      ["human", "title:title jack:notes knob:timing knob:velocity jack:notes"],
    ]) {
      const face = await pg(`grid.face(${JSON.stringify(id)})`);
      check(
        `${id} is drawn as its declared face`,
        Array.isArray(face) &&
          face.map((b) => `${b.kind}:${b.name}`).join(" ") === expected,
        JSON.stringify(face?.map((b) => `${b.kind}:${b.name}`)),
      );
    }
    const chord = await pg('grid.face("chord")');
    check(
      "the chord module, with no declared face, still has its two jacks",
      Array.isArray(chord) &&
        chord.filter((b) => b.kind === "jack").length === 2,
      JSON.stringify(chord?.map((b) => `${b.kind}:${b.name}`)),
    );
    await screenshot("note-fx");
  },
};

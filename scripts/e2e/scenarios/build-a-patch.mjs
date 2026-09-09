/**
 * A patch built entirely through the automation API, then heard: the loaded patch is rendered by
 * the engine and measured, so "does what I built make a sound" is a number rather than a guess.
 */
export default {
  name: "build-a-patch",
  description: "build a patch through pg, render it through the engine, and check it is audible",
  async run({ pg, idle, screenshot, check }) {
    await idle();
    await pg('commands.run("project.new")');
    await idle();

    // Silence first, so the sound later is the patch's and not something already there.
    const empty = await pg("engine.render({ seconds: 0.25 })");
    check("an empty patch renders silence", empty.rms[0] === 0 && empty.peak[1] === 0, JSON.stringify(empty));

    await pg('patch.addModule("osc.sawtooth", { id: "osc", x: 48, y: 48 })');
    await pg('patch.addModule("io.audioOut", { id: "out", x: 384, y: 72 })');
    await idle();
    const unplugged = await pg("engine.render({ seconds: 0.25 })");
    check("two modules with no cable are still silent", unplugged.rms[0] === 0, JSON.stringify(unplugged));

    await pg('patch.connect({ module: "osc", port: "out" }, { module: "out", port: "inL" })');
    await pg('patch.setParam("out", "gain", 0.5)');
    await idle();
    const sound = await pg("engine.render({ seconds: 0.5 })");
    check("a cabled oscillator is audible", sound.rms[0] > 0.05, JSON.stringify(sound));
    check("and not clipping", sound.peak[0] <= 1 && sound.peak[1] <= 1, JSON.stringify(sound));
    check("on both channels", sound.rms[1] > 0.05, JSON.stringify(sound));
    check("at the engine's rate", sound.sampleRate === 48000 && sound.frames === 24000, JSON.stringify(sound));

    // The knob, by the same path the inspector takes: half the gain is half the level.
    await pg('patch.setParam("out", "gain", 0.25)');
    await idle();
    const quieter = await pg("engine.render({ seconds: 0.5 })");
    check("turning the output down is measurable", quieter.rms[0] < sound.rms[0] * 0.6, `${sound.rms[0]} -> ${quieter.rms[0]}`);

    // A picture of what was built, for anyone reading the run.
    const nodes = await pg("grid.nodes()");
    check("both modules are drawn", nodes.length === 2 && nodes.every((n) => n.rect.width > 0), JSON.stringify(nodes));
    await screenshot("build-a-patch");

    // A WAV on request, for analysis beyond RMS.
    const out = `${(await pg("snapshot()")).workspace.root}/render.wav`;
    const written = await pg(`engine.render({ seconds: 0.25, out: ${JSON.stringify(out)} })`);
    check("a WAV is written where asked", written.out === out, JSON.stringify(written));
  },
};

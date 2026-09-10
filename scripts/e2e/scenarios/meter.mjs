import { projectDoc, seedProject } from "../harness.mjs";

/**
 * A meter showing the level on the wire, and lighting its clip light when the patch is pushed past
 * full scale. The clip is the assertion worth having: it is the one thing a meter exists to report,
 * and the reason the module holds it rather than leaving it to a reader that looks sixty times a second.
 */
const PATCH = {
  schemaVersion: 1,
  feedbackMode: "sample",
  modules: [
    { id: "sine", type: "osc.sine", x: 48, y: 48 },
    { id: "vca", type: "amp.vca", x: 264, y: 48, params: { gain: 0.5 } },
    { id: "level", type: "display.meter", x: 264, y: 192 },
    { id: "out", type: "io.audioOut", x: 504, y: 48 },
  ],
  edges: [
    {
      id: "e1",
      from: { module: "sine", port: "out" },
      to: { module: "vca", port: "in" },
    },
    {
      id: "e2",
      from: { module: "vca", port: "out" },
      to: { module: "out", port: "inL" },
    },
    {
      id: "e3",
      from: { module: "vca", port: "out" },
      to: { module: "level", port: "in" },
    },
  ],
};

const BLOCK = 'window.pg.grid.face("level")?.find((b) => b.kind === "meter")';

export default {
  name: "meter",
  description:
    "a meter shows the level on its face and lights its clip light when the patch is pushed past full scale",
  seed(ws) {
    seedProject(
      ws,
      "meter",
      projectDoc({ id: "meter", name: "Meter", patch: PATCH }),
    );
  },
  async run({ evaluate, pg, idle, checkEventually, screenshot, check }) {
    await evaluate(`openProject("Meter");`);
    await idle();

    const face = await pg('grid.face("level")');
    check(
      "the meter's face is its input and the bars",
      Array.isArray(face) &&
        face.map((b) => `${b.kind}:${b.name}`).join(" ") ===
          "title:title jack:in meter:meter",
      JSON.stringify(face?.map((b) => `${b.kind}:${b.name}`)),
    );
    check(
      "nothing has been metered before the patch plays",
      face?.find((b) => b.kind === "meter")?.level === null,
      JSON.stringify(face?.find((b) => b.kind === "meter")),
    );

    await pg('commands.run("transport.play")');
    await idle();
    await checkEventually(
      "the meter reads a level, on both channels, without clipping",
      `(() => {
        const l = ${BLOCK}?.level;
        return l != null && l.peak.length === 2 && l.peak.every((p) => p > 0.2 && p < 1) &&
          l.clipped.every((c) => c === false);
      })()`,
    );
    await screenshot("meter-level");

    // Push it past full scale: the clip light comes on and the peak is pinned high.
    await pg('patch.setParam("vca", "gain", 2)');
    await idle();
    await checkEventually(
      "pushed past full scale the clip light comes on",
      `(() => {
        const l = ${BLOCK}?.level;
        return l != null && l.clipped.every((c) => c === true) && l.peak.every((p) => p > 1);
      })()`,
    );
    await screenshot("meter-clipped");

    // Silence it: the held peak falls back, and the clip light goes out on its own.
    await pg('patch.setParam("vca", "gain", 0)');
    await checkEventually(
      "silenced, the held peak falls and the clip light goes out",
      `(() => {
        const l = ${BLOCK}?.level;
        return l != null && l.peak.every((p) => p < 0.1) && l.clipped.every((c) => c === false);
      })()`,
      { timeoutMs: 15000 },
    );
  },
};

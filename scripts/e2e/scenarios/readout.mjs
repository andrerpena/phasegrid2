import { projectDoc, seedProject } from "../harness.mjs";

/**
 * A readout showing the number on the wire: a constant reads back exactly, and follows the knob that
 * sets it. The whole telemetry path in one assertion -- the engine's Value slot, the subscription, the
 * face -- with an exact expected number rather than "something happened".
 */
const PATCH = {
  schemaVersion: 1,
  voiceCount: 1,
  feedbackMode: "sample",
  modules: [
    {
      id: "src",
      type: "math.scaleOffset",
      x: 48,
      y: 48,
      params: { offset: 0.5 },
    },
    { id: "readout", type: "display.value", x: 288, y: 48 },
  ],
  edges: [
    {
      id: "e1",
      from: { module: "src", port: "out" },
      to: { module: "readout", port: "in" },
    },
  ],
};

/** The readout block on the module's face, from the page. */
const BLOCK = 'window.pg.grid.face("readout")?.find((b) => b.kind === "value")';
/** Both channels within a hair of the expected number. */
const reads = (expected) => `(() => {
  const c = ${BLOCK}?.reading?.channels;
  return Array.isArray(c) && c.length === 2 && c.every((v) => Math.abs(v - ${expected}) < 1e-4);
})()`;

export default {
  name: "readout",
  description:
    "a readout shows the value on the wire, exactly, and follows the parameter that sets it",
  seed(ws) {
    seedProject(
      ws,
      "readout",
      projectDoc({ id: "readout", name: "Readout", patch: PATCH }),
    );
  },
  async run({ evaluate, pg, idle, checkEventually, screenshot, check }) {
    await evaluate(`openProject("Readout");`);
    await idle();

    const face = await pg('grid.face("readout")');
    check(
      "the readout's face is its input and the number",
      Array.isArray(face) &&
        face.map((b) => `${b.kind}:${b.name}`).join(" ") ===
          "title:title jack:in value:value",
      JSON.stringify(face?.map((b) => `${b.kind}:${b.name}`)),
    );
    check(
      "nothing has been read before the patch plays",
      face?.find((b) => b.kind === "value")?.reading === null,
      JSON.stringify(face?.find((b) => b.kind === "value")),
    );

    await pg('commands.run("transport.play")');
    await idle();
    await checkEventually(
      "the readout shows the constant on the wire",
      reads(0.5),
    );
    await screenshot("readout-positive");

    // A negative value: the reason a readout is not a meter, which would show 0.25 for both.
    await pg('patch.setParam("src", "offset", -0.25)');
    await idle();
    await checkEventually("and follows the knob, sign and all", reads(-0.25));
    await screenshot("readout-negative");
  },
};

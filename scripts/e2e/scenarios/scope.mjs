import { projectDoc, seedProject } from "../harness.mjs";

/**
 * A scope drawing the wire it taps: the engine keeps a window of the signal and publishes it into
 * the segment, the face reads it at frame rate. A tone shows as a full-scale trace that keeps
 * arriving; silence the tone and the trace goes flat; a time knob is a knob like any other.
 */
const PATCH = {
  schemaVersion: 1,
  voiceCount: 1,
  feedbackMode: "sample",
  modules: [
    { id: "sine", type: "osc.sine", x: 48, y: 48 },
    { id: "vca", type: "amp.vca", x: 264, y: 48, params: { gain: 1 } },
    { id: "scope", type: "display.scope", x: 264, y: 192 },
    { id: "out", type: "io.audioOut", x: 480, y: 48 },
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
      to: { module: "scope", port: "in" },
    },
  ],
};

/** The scope block on the module's face, from the page. */
const SCOPE_BLOCK =
  'window.pg.grid.face("scope")?.find((b) => b.kind === "scope")';

/**
 * Whether a new window arrived since this was last asked: an expression for `checkEventually`. The
 * first trace counts, and after that only a different publish count does, so asking twice proves the
 * scope keeps drawing rather than having drawn once.
 */
const drawing = `(() => {
  const now = ${SCOPE_BLOCK}?.trace?.index;
  if (now === undefined || now === null || now === window.__pgScopeIndex) return false;
  window.__pgScopeIndex = now;
  return true;
})()`;

export default {
  name: "scope",
  description:
    "a scope draws the tone on its face, keeps drawing, goes flat when the tone does, and has a time knob",
  seed(ws) {
    seedProject(
      ws,
      "scope",
      projectDoc({ id: "scope", name: "Scope", patch: PATCH }),
    );
  },
  async run({ evaluate, pg, idle, checkEventually, screenshot, check }) {
    await evaluate(`openProject("Scope");`);
    await idle();

    // The face the engine declared: one jack, the screen, the time knob.
    const face = await pg('grid.face("scope")');
    check(
      "the scope's face is its input, one scope block and the time knob",
      Array.isArray(face) &&
        face.map((b) => `${b.kind}:${b.name}`).join(" ") ===
          "title:title jack:in scope:scope knob:time",
      JSON.stringify(face?.map((b) => `${b.kind}:${b.name}`)),
    );
    const screen = face?.find((b) => b.kind === "scope");
    check(
      "nothing has been drawn before the patch plays",
      screen !== undefined && screen.trace === null,
      JSON.stringify(screen),
    );

    await pg('commands.run("transport.play")');
    await idle();
    await checkEventually("a window arrives on the scope", drawing);
    await checkEventually("and another: the scope keeps drawing", drawing);
    await checkEventually(
      "the window is a full-scale tone, a whole window long",
      `(() => { const t = ${SCOPE_BLOCK}?.trace; return t !== null && t !== undefined && t.peak > 0.9 && t.frames === 1024; })()`,
    );
    await screenshot("scope-tone");

    // Silence the tone through the VCA: the trace goes flat.
    await pg('patch.setParam("vca", "gain", 0)');
    await idle();
    await checkEventually(
      "with the tone silenced the trace goes flat",
      `(${SCOPE_BLOCK}?.trace?.peak ?? 1) < 0.01`,
    );

    // The time knob is a parameter like any other: set it, and the face is still whole.
    await pg('patch.setParam("scope", "time", 100)');
    await idle();
    const after = await pg('grid.face("scope")');
    check(
      "after a time change the face still has its one scope block",
      after?.filter((b) => b.kind === "scope").length === 1,
      JSON.stringify(after?.map((b) => `${b.kind}:${b.name}`)),
    );
    await screenshot("scope-flat");
  },
};

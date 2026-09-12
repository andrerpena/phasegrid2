import { projectDoc, seedProject } from "../harness.mjs";

/**
 * Two projects open at once, switched between, and a pattern edited afterwards.
 *
 * The canvas is rebuilt per project, so switching tabs destroys one Pixi application and makes
 * another. Pixi keeps pools that are shared by every canvas in the page, and a canvas that released
 * them on its way out took the next one with it: its first text change afterwards returned a
 * texture to a pool that no longer existed, the render loop threw on every frame and the grid went
 * blank. The harness fails on any error the page reports, so this only has to walk the path.
 */
const WITH_PATTERN = {
  schemaVersion: 1,
  feedbackMode: "sample",
  modules: [
    {
      id: "pat",
      type: "notes.pattern",
      x: 48,
      y: 48,
      data: { pattern: "c4 e4 g4", velocity: "" },
    },
    { id: "out", type: "io.audioOut", x: 336, y: 48 },
  ],
  edges: [],
};

export default {
  name: "project-switching",
  description:
    "two projects open, tabs switched back and forth, and a pattern edited on the canvas afterwards",
  seed(ws) {
    seedProject(
      ws,
      "alpha",
      projectDoc({ id: "alpha", name: "Alpha", patch: WITH_PATTERN }),
    );
    seedProject(ws, "beta", projectDoc({ id: "beta", name: "Beta" }));
  },
  async run({ evaluate, pg, idle, waitFor, checkEventually, check }) {
    const open = async () =>
      (await pg("snapshot().projects.open")).map((p) => p.name);
    await evaluate(`openProject("Alpha");`);
    await waitFor('window.pg.grid.node("pat") !== null', {
      label: "the pattern is on the canvas",
    });
    await evaluate(`openProject("Beta");`);
    await waitFor("window.pg.snapshot().projects.open.length === 2", {
      label: "both projects are open",
    });
    check("both are open", (await open()).join() === "Alpha,Beta");

    // Back and forth twice: each switch destroys one canvas and builds another.
    const alpha = (await pg("stores.project.getState().projects")).find(
      (p) => p.name === "Alpha",
    ).id;
    const beta = (await pg("stores.project.getState().projects")).find(
      (p) => p.name === "Beta",
    ).id;
    for (const id of [alpha, beta, alpha]) {
      await pg(`stores.project.getState().activate(${JSON.stringify(id)})`);
      await idle();
    }
    await waitFor('window.pg.grid.node("pat") !== null', {
      label: "the pattern is back on the canvas",
    });

    // Then the edit that changes a text on the canvas -- the same op the inspector sends.
    await pg(
      'patch.apply([{ op: "moduleSetData", id: "pat", data: { pattern: "a3 c4 e4 g4", velocity: "" } }], "Edit pattern")',
    );
    await checkEventually(
      "the canvas shows the edited pattern",
      'window.pg.grid.face("pat")?.find((b) => b.kind === "text" && b.name === "pattern")?.text === "a3 c4 e4 g4"',
    );
    await pg(
      'patch.apply([{ op: "moduleSetData", id: "pat", data: { pattern: "c4", velocity: "" } }], "Edit pattern")',
    );
    await checkEventually(
      "and keeps drawing after another",
      'window.pg.grid.face("pat")?.find((b) => b.kind === "text" && b.name === "pattern")?.text === "c4"',
    );
  },
};

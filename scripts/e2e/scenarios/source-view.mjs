import { projectDoc } from "../harness.mjs";

/**
 * The project as text, next to the project as a grid.
 *
 * The user asked for a way to get at a project's JSON without leaving the application. This is it: a
 * Grid | Source toggle in the header, the source being exactly the document Save writes, in the same
 * editor the settings and the pattern fields use, with the project schema behind it. Applying an edit
 * goes through the same store action opening a file goes through, so the header and the engine agree
 * with the text afterwards. Both are commands, so a script can drive them the way a person does.
 */
const PATCH = {
  schemaVersion: 1,
  feedbackMode: "sample",
  modules: [
    { id: "osc", type: "osc.sine", x: 48, y: 48 },
    { id: "out", type: "io.audioOut", x: 384, y: 48, params: { gain: 0.4 } },
  ],
  edges: [
    {
      id: "e1",
      from: { module: "osc", port: "out" },
      to: { module: "out", port: "inL" },
    },
  ],
};

export default {
  name: "source-view",
  description:
    "toggle a project between its grid and the JSON Save writes, apply an edit from the text, and find the reveal command",
  async run({ evaluate, pg, idle, check, checkEventually, text, screenshot }) {
    await pg('commands.run("project.new")');
    await idle();
    // Seeded rather than built by hand so the text has something in it worth reading. The id is
    // fetched first: inside a `pg(...)` expression only the leading name is the automation object.
    const newId = (await pg("snapshot()")).projects.activeId;
    await pg(
      `stores.project.getState().replace(${JSON.stringify(newId)}, ${JSON.stringify(
        projectDoc({ id: "src", name: "Source", tempo: 80, patch: PATCH }),
      )})`,
    );
    await idle();

    const before = await pg("snapshot()");
    check(
      "a project opens in the grid",
      before.projects.open[0].view === "grid",
      JSON.stringify(before.projects),
    );

    await pg('commands.run("project.toggleSource")');
    await checkEventually("toggling shows the project's source", async () => {
      const s = await pg("snapshot()");
      return s.projects.open[0].view === "source";
    });
    await checkEventually(
      "and the text on screen is the document Save writes, tempo and all",
      async () => {
        const shown = await text();
        return (
          shown.includes('"schemaVersion"') &&
          shown.includes('"tempo": 80') &&
          shown.includes('"osc.sine"')
        );
      },
    );

    await screenshot("source-view");

    // An apply from the text: the same action Cmd+Enter runs, driven through the store so the check
    // does not depend on a real keyboard. The header follows the tempo; the engine follows the patch.
    const id = (await pg("snapshot()")).projects.activeId;
    const doc = await pg(
      `stores.project.getState().snapshot(${JSON.stringify(id)})`,
    );
    doc.tempo = 133;
    doc.patch.modules.find((m) => m.id === "out").params.gain = 0.2;
    await pg(
      `stores.project.getState().replace(${JSON.stringify(id)}, ${JSON.stringify(doc)})`,
    );
    await idle();
    await checkEventually(
      "an applied edit reaches the header and the patch",
      async () => {
        const s = await pg("snapshot()");
        return (
          s.projects.open[0].tempo === 133 &&
          s.patch.modules.find((m) => m.id === "out").params.gain === 0.2 &&
          s.projects.open[0].dirty === true
        );
      },
    );

    await pg('commands.run("project.toggleSource")');
    await checkEventually(
      "toggling again is the grid, with the edit in it",
      async () => {
        const s = await pg("snapshot()");
        return s.projects.open[0].view === "grid";
      },
    );

    // The file itself: a command, listed and reachable. Not run here -- it opens the system's file
    // manager, which a headless run has no business doing -- and a project that was never saved has
    // no file to reveal, which the command treats as nothing to do rather than an error.
    const commands = await pg("commands.list()");
    check(
      "the project file can be revealed by command",
      commands.some((c) => c.id === "project.revealFile"),
      "",
    );
    await evaluate(`await window.pg.commands.run("project.revealFile");`);
    check("and revealing an unsaved project is a quiet no-op", true);
  },
};

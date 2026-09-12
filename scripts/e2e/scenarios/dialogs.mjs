import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The native questions, answered by script: closing a dirty tab three ways, and deleting a project.
 * The flows are the application's own -- the same functions the close button and the Projects
 * panel call -- with only the box itself answered ahead of time.
 */
export default {
  name: "dialogs",
  description:
    "the unsaved-work box and the delete confirmation, answered ahead of time",
  async run({ workspace: ws, pg, idle, check }) {
    await idle();
    const dirty = async () => {
      await pg('commands.run("project.new")');
      await pg('patch.addModule("osc.sine")');
      await idle();
    };
    const open = async () => (await pg("snapshot()")).projects.open;

    // Cancel: the tab stays.
    await dirty();
    await pg('dialogs.answer("confirmUnsaved", "cancel")');
    await pg("workspace.closeProject()");
    await idle();
    check(
      "cancel keeps the tab",
      (await open()).length === 1,
      JSON.stringify(await open()),
    );

    // Discard: the tab goes and nothing is written.
    await pg('dialogs.answer("confirmUnsaved", "discard")');
    await pg("workspace.closeProject()");
    await idle();
    check(
      "discard closes the tab",
      (await open()).length === 0,
      JSON.stringify(await open()),
    );
    check("and writes nothing", !existsSync(join(ws, "projects", "untitled")));

    // Save: the project is filed under its own name, no name dialog, and the tab goes.
    await dirty();
    const name = (await open())[0].name;
    await pg('dialogs.answer("confirmUnsaved", "save")');
    await pg("workspace.closeProject()");
    await idle();
    check("save closes the tab", (await open()).length === 0);
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    check(
      `and files it as projects/${slug}`,
      existsSync(join(ws, "projects", slug, "project.json")),
      name,
    );
    check(
      "and the Projects panel lists it",
      (await pg("snapshot()")).workspace.projects.some((p) => p.slug === slug),
    );

    // Deleting: refused, then confirmed.
    await pg('dialogs.answer("confirmDelete", false)');
    await pg(
      `stores.workspace.getState().removeProject(${JSON.stringify(slug)})`,
    );
    await idle();
    check(
      "a refused delete leaves the folder",
      existsSync(join(ws, "projects", slug)),
    );
    await pg('dialogs.answer("confirmDelete", true)');
    await pg(
      `stores.workspace.getState().removeProject(${JSON.stringify(slug)})`,
    );
    await idle();
    check(
      "a confirmed delete removes it",
      !existsSync(join(ws, "projects", slug)),
    );
    check(
      "and the list no longer has it",
      !(await pg("snapshot()")).workspace.projects.some((p) => p.slug === slug),
    );

    // A folder chosen by script, through the same command the palette runs.
    // The native chooser can create a folder; a scripted path has to exist already.
    const other = join(ws, "..", `${ws.split("/").at(-1)}-other`);
    mkdirSync(other, { recursive: true });
    await pg(`dialogs.answer("chooseWorkspace", ${JSON.stringify(other)})`);
    await pg('commands.run("workspace.open")');
    await idle();
    check(
      "a scripted folder choice switches the workspace",
      (await pg("snapshot()")).workspace.root === other,
      (await pg("snapshot()")).workspace.root,
    );
    check("and scaffolds it", existsSync(join(other, "workspace.json")));
  },
};

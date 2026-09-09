import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The gate with nothing remembered, and the shell once a folder has been picked. Two launches,
 * because both halves only happen at startup, and neither names a workspace on the command line:
 * this is the one scenario about how the application finds a folder on its own.
 */
export default {
  name: "workspace-gate",
  description:
    "the gate appears with nothing remembered; picking a folder scaffolds it and is remembered",
  launches: true,
  async run({ launch, workspace: ws, userData, check }) {
    await launch({ workspace: null, userData }, async ({ evaluate, text }) => {
      const gate = await text();
      check(
        "the gate appears when nothing is remembered",
        gate.includes("Open Workspace"),
        gate.slice(0, 100),
      );
      check("the shell is not behind it", !gate.includes("Catalog"));

      // The folder dialog is the platform's; the driver stands in for the person who picked a folder.
      // Everything after this is the application's own path.
      const opened = await evaluate(
        `return await window.workspace.openAt(${JSON.stringify(ws)});`,
      );
      check(
        "picking a folder scaffolds it",
        opened?.ok === true,
        JSON.stringify(opened),
      );
      for (const entry of [
        "workspace.json",
        "projects",
        "modules",
        ".phasegrid",
        ".gitignore",
      ])
        check(`scaffolded ${entry}`, existsSync(join(ws, entry)));
      check(
        ".gitignore excludes the session",
        readFileSync(join(ws, ".gitignore"), "utf8").includes(".phasegrid/"),
      );
    });

    await launch({ workspace: null, userData }, async ({ evaluate, text }) => {
      const shell = await text();
      const isShell = await evaluate(
        `return document.querySelector('[data-kb-scope="catalog"]') !== null;`,
      );
      check(
        "relaunching reopens the remembered workspace",
        isShell === true,
        shell.slice(0, 150),
      );
      check("the status bar names it", shell.includes(ws.split("/").at(-1)));
      check(
        "the Projects panel says it is empty",
        shell.includes("Nothing saved here yet"),
        shell.slice(0, 150),
      );
    });
  },
};

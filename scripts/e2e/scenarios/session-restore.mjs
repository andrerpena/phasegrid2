import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectDoc, seedProject } from "../harness.mjs";

/**
 * A workspace with a project, a session and settings already on disk: the tab comes back, clean, at
 * the tempo it was saved with, and the settings load.
 */
export default {
  name: "session-restore",
  description:
    "the tabs that were open come back, unsaved-free, with the workspace's settings",
  seed(ws) {
    seedProject(
      ws,
      "my-track",
      projectDoc({ id: "my-track", name: "My Track", tempo: 137 }),
    );
    mkdirSync(join(ws, ".phasegrid"), { recursive: true });
    writeFileSync(
      join(ws, ".phasegrid", "session.json"),
      JSON.stringify({
        schemaVersion: 1,
        open: ["my-track"],
        active: "my-track",
      }),
    );
    writeFileSync(
      join(ws, "workspace.json"),
      JSON.stringify({
        schemaVersion: 1,
        name: "restored",
        settings: { "grid.snap": 16 },
      }),
    );
  },
  async run({ evaluate, text, check }) {
    const shell = await text();
    check(
      "the project that was open reopens",
      shell.includes("My Track"),
      shell.slice(0, 200),
    );
    check("and it is not marked as unsaved", !shell.includes("•"));
    const tempo = await evaluate(
      `return document.querySelector('input[aria-label="Tempo"]')?.value ?? "";`,
    );
    check("with the tempo it was saved at", tempo === "137", tempo);
    const settings = await evaluate(
      `const s = await window.workspace.readSettings(); return s.ok && s.value !== null ? JSON.parse(s.value) : null;`,
    );
    check(
      "the settings on disk are the ones loaded",
      settings?.["grid.snap"] === 16,
      JSON.stringify(settings),
    );
    check("the status bar names the workspace", shell.includes("restored"));
  },
};

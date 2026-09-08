#!/usr/bin/env node
/**
 * Drives the built application through the workspace, three launches deep.
 *
 * Run `npx electron-vite build` first, then `node scripts/e2e-workspace.mjs`. It launches the real
 * application against a throwaway user-data directory and a throwaway folder, and talks to it over the
 * Chrome DevTools protocol — no Playwright, no test-only code in the product.
 *
 * Three launches rather than one, because the things worth checking here only happen at startup: the
 * gate with nothing remembered, the shell with a workspace remembered, and the tabs coming back.
 *
 * The folder chooser and the unsaved-work box are the platform's own and cannot be answered from here.
 * The chooser is stood in for by calling the bridge directly, once; the box is covered by unit tests.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let PORT = 9400;
const userData = mkdtempSync(join(tmpdir(), "pg-ud-"));
const ws = mkdtempSync(join(tmpdir(), "pg-ws-"));
console.log("userData:", userData, "\nworkspace:", ws, "\n");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(label, condition, extra = "") {
  if (!condition) failures++;
  console.log(
    `${condition ? "  ok" : "FAIL"}  ${label}${extra && !condition ? ` — ${extra}` : ""}`,
  );
}

const HELPERS = `
const setValue = (el, value) => {
  if (!el) throw new Error("no element to set");
  const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const press = (key, mods = {}) => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods }));
const byText = (selector, text) => [...document.querySelectorAll(selector)].find((e) => e.textContent.trim() === text);
const click = (selector, text) => { const el = byText(selector, text); if (!el) throw new Error("no button: " + text); el.click(); };
`;

async function launch(run) {
  // A fresh port per launch, and its own process group. Electron leaves helper processes behind when
  // the main process is killed, and one of those still holding the port is indistinguishable from the
  // next launch answering — which is a way to test the previous build for a long time.
  PORT += 1;
  const app = spawn(
    resolve(ROOT, "node_modules/.bin/electron"),
    [".", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
  app.stdout.on("data", (b) => process.stderr.write(`[app] ${b}`));
  app.stderr.on("data", (b) => process.stderr.write(`[app] ${b}`));

  let socket;
  let nextId = 1;
  const pending = new Map();

  try {
    let url = null;
    for (let i = 0; i < 60 && url === null; i++) {
      try {
        const targets = await (
          await fetch(`http://127.0.0.1:${PORT}/json/list`)
        ).json();
        url =
          targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl)
            ?.webSocketDebuggerUrl ?? null;
      } catch {}
      if (url === null) await sleep(500);
    }
    if (url === null) throw new Error("no debuggable page appeared");

    socket = new WebSocket(url);
    await new Promise((ok, bad) => {
      socket.addEventListener("open", ok, { once: true });
      socket.addEventListener("error", bad, { once: true });
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const waiter = pending.get(message.id);
      if (waiter) {
        pending.delete(message.id);
        waiter(message);
      }
    });

    const send = (method, params) => {
      const id = nextId++;
      return new Promise((ok) => {
        pending.set(id, ok);
        socket.send(JSON.stringify({ id, method, params }));
      });
    };
    const evaluate = async (expression) => {
      const reply = await send("Runtime.evaluate", {
        expression: `(async () => { ${HELPERS} ${expression} })()`,
        awaitPromise: true,
        returnByValue: true,
      });
      if (reply.result?.exceptionDetails)
        throw new Error(
          `evaluate threw: ${reply.result.exceptionDetails.exception?.description ?? JSON.stringify(reply.result.exceptionDetails)}`,
        );
      return reply.result?.result?.value;
    };
    const text = () => evaluate("return document.body.innerText;");

    await send("Runtime.enable");
    await sleep(1800);
    await run({ evaluate, text });
  } finally {
    try {
      socket?.close();
    } catch {}
    try {
      process.kill(-app.pid, "SIGKILL");
    } catch {
      app.kill("SIGKILL");
    }
    await sleep(1200);
  }
}

try {
  // ── First launch: nothing remembered ──────────────────────────────────────
  await launch(async ({ evaluate, text }) => {
    const gate = await text();
    check(
      "1. the gate appears when nothing is remembered",
      gate.includes("Open Workspace"),
      gate.slice(0, 100),
    );
    check("1. the shell is not behind it", !gate.includes("Catalog"));

    // The folder dialog is the platform's and cannot be answered from here, so the driver stands in for
    // the person who picked a folder. Everything after this is the application's own path.
    const opened = await evaluate(
      `return await window.workspace.openAt(${JSON.stringify(ws)});`,
    );
    check(
      "2. picking a folder scaffolds it",
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
      check(`2. scaffolded ${entry}`, existsSync(join(ws, entry)));
    check(
      "2. .gitignore excludes the session",
      readFileSync(join(ws, ".gitignore"), "utf8").includes(".phasegrid/"),
    );
  });

  // ── Second launch: the pointer is remembered, so the shell opens ──────────
  await launch(async ({ evaluate, text }) => {
    const shell = await text();
    const isShell = await evaluate(
      `return document.querySelector('[data-kb-scope="catalog"]') !== null;`,
    );
    check(
      "3. relaunching reopens the workspace",
      isShell === true,
      shell.slice(0, 150),
    );
    check("3. the status bar names it", shell.includes(ws.split("/").at(-1)));
    check(
      "3. the Projects panel says it is empty",
      shell.includes("Nothing saved here yet"),
      shell.slice(0, 150),
    );

    await evaluate(`click("button", "+");`);
    await sleep(400);
    await evaluate(
      `setValue(document.querySelector('input[aria-label="Tempo"]'), "137");`,
    );
    await sleep(300);
    check("4. the tab shows a dot once edited", (await text()).includes("•"));
    check(
      "4. the button offers Save As, having nowhere to save yet",
      (await text()).includes("Save As…"),
    );

    await evaluate(`click("button", "Save As…");`);
    await sleep(400);
    await evaluate(
      `setValue(document.querySelector("dialog input"), "My Track");`,
    );
    await sleep(250);
    const hint = await evaluate(
      "return document.querySelector('dialog')?.innerText ?? '';",
    );
    check(
      "4. the dialog shows the folder it will make",
      hint.includes("projects/my-track/"),
      hint,
    );
    await evaluate(
      `[...document.querySelectorAll("dialog button")].find((b) => b.textContent.trim() === "Save").click();`,
    );
    await sleep(700);

    const file = join(ws, "projects", "my-track", "project.json");
    check("4. the project is on disk", existsSync(file));
    if (existsSync(file)) {
      const doc = JSON.parse(readFileSync(file, "utf8"));
      check(
        "4. it saved the tempo that was typed",
        doc.tempo === 137,
        String(doc.tempo),
      );
      check(
        "4. it saved under the name given",
        doc.name === "My Track",
        doc.name,
      );
      check("4. it does not record its own path", doc.slug === undefined);
    }
    const after = await text();
    check("4. the dot cleared", !after.includes("•"));
    check("4. the Projects panel lists it", after.includes("My Track"));

    const session = JSON.parse(
      readFileSync(join(ws, ".phasegrid", "session.json"), "utf8"),
    );
    check(
      "5. the session records the open tab",
      session.open.includes("my-track") && session.active === "my-track",
      JSON.stringify(session),
    );

    // Settings, and a keybinding taking effect without a relaunch.
    await evaluate(`click("button", "Settings");`);
    await sleep(300);
    // The catalogue's own search field: present exactly when the left column is. Matching on the panel
    // title does not work, because the title is uppercased by the stylesheet and `innerText` says so.
    const leftShown = `document.querySelector('[data-kb-scope="catalog"]') !== null`;
    const toggled = await evaluate(
      `press("b", { metaKey: true }); await new Promise(r => setTimeout(r, 250)); return ${leftShown};`,
    );
    check(
      "6. mod+b toggles the left panel by default",
      toggled === false,
      String(toggled),
    );
    await evaluate(`press("b", { metaKey: true });`);
    await sleep(300);
    check("6. and toggles it back", await evaluate(`return ${leftShown};`));

    await evaluate(
      `setValue(document.querySelector('textarea[aria-label="Workspace settings"]'), ${JSON.stringify('{"grid.snap": 16, "keybindings": [{"key": "mod+b", "remove": true}]}')});`,
    );
    await sleep(600);
    const written = JSON.parse(
      readFileSync(join(ws, "workspace.json"), "utf8"),
    );
    check(
      "6. the settings reached workspace.json",
      written.settings["grid.snap"] === 16,
      JSON.stringify(written.settings),
    );
    check("6. the file kept its name field", typeof written.name === "string");
    const stillThere = await evaluate(
      `press("b", { metaKey: true }); await new Promise(r => setTimeout(r, 250)); return ${leftShown};`,
    );
    check(
      "6. removing a binding takes effect without a relaunch",
      stillThere === true,
      String(stillThere),
    );

    // And adding one does too, on the same read of the file.
    await evaluate(
      `setValue(document.querySelector('textarea[aria-label="Workspace settings"]'), ${JSON.stringify('{"grid.snap": 16, "keybindings": [{"key": "mod+b", "remove": true}, {"key": "mod+alt+j", "command": "workbench.cycleTheme"}]}')});`,
    );
    await sleep(500);
    // By its label: the header has selects of its own (meter, scale) and they come first in the DOM.
    const themeSelect = `[...document.querySelectorAll("label")].find((l) => l.textContent.trim().startsWith("Theme")).querySelector("select").value`;
    const themeBefore = await evaluate(`return ${themeSelect};`);
    await evaluate(`press("j", { metaKey: true, altKey: true });`);
    await sleep(400);
    const themeAfter = await evaluate(`return ${themeSelect};`);
    check(
      "6. adding a binding takes effect without a relaunch",
      themeBefore !== themeAfter,
      `${themeBefore} -> ${themeAfter}`,
    );

    // Text that does not parse never reaches the file.
    await evaluate(
      `setValue(document.querySelector('textarea[aria-label="Workspace settings"]'), '{"grid.snap": ');`,
    );
    await sleep(500);
    check(
      "6. text that does not parse is not written",
      JSON.parse(readFileSync(join(ws, "workspace.json"), "utf8")).settings[
        "grid.snap"
      ] === 16,
    );
    check(
      "6. and the editor says why",
      (await text()).toLowerCase().includes("json"),
    );

    const escaped = await evaluate(
      `return await window.workspace.writeProject("../escaped", "{}");`,
    );
    check(
      "7. a slug that climbs out of the workspace is refused",
      escaped?.ok === false,
      JSON.stringify(escaped),
    );
    check(
      "7. and nothing was written outside it",
      !existsSync(join(ws, "..", "escaped")),
    );
  });

  // ── Third launch: the tab that was open comes back ────────────────────────
  await launch(async ({ evaluate, text }) => {
    const shell = await text();
    check("8. the project that was open reopens", shell.includes("My Track"));
    check("8. and it is not marked as unsaved", !shell.includes("•"));
    const tempo = await evaluate(
      `return document.querySelector('input[aria-label="Tempo"]')?.value ?? "";`,
    );
    check("8. with the tempo it was saved at", tempo === "137", tempo);
    check(
      "8. the settings survived too",
      (await text()).length > 0 &&
        JSON.parse(readFileSync(join(ws, "workspace.json"), "utf8")).settings[
          "grid.snap"
        ] === 16,
    );
  });
} catch (error) {
  console.error("\ndriver failed:", error.message);
  failures++;
} finally {
  console.log(`\nworkspace: ${readdirSync(ws).join(", ")}`);
  console.log(`projects:  ${readdirSync(join(ws, "projects")).join(", ")}`);
  console.log(
    failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

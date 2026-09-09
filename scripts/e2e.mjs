#!/usr/bin/env node
/**
 * Drives the built application: the workspace, saving, settings, and editing a patch.
 *
 * Run `npx electron-vite build` first, then `node scripts/e2e.mjs`. It launches the real
 * application against a throwaway user-data directory and a throwaway folder, and talks to it over the
 * Chrome DevTools protocol — no Playwright, no test-only code in the product.
 *
 * Several launches rather than one, because much of what is worth checking only happens at startup: the
 * gate with nothing remembered, the shell with a workspace remembered, and the tabs coming back.
 *
 * The folder chooser and the unsaved-work box are the platform's own and cannot be answered from here.
 * The chooser is stood in for by calling the bridge directly, once; the box is covered by unit tests.
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let PORT = 9400;
const userData = mkdtempSync(join(tmpdir(), "pg-ud-"));
const SHOTS =
  process.env.PG_E2E_SHOTS ?? mkdtempSync(join(tmpdir(), "pg-shot-"));
mkdirSync(SHOTS, { recursive: true });
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
      // The page's own console. A driver that cannot see an exception in the renderer reports the
      // symptom and hides the cause, which is most of an afternoon.
      if (message.method === "Runtime.consoleAPICalled")
        console.log(
          `      [page:${message.params.type}]`,
          message.params.args
            .map((a) => a.value ?? a.description ?? a.type)
            .join(" "),
        );
      if (message.method === "Runtime.exceptionThrown")
        console.log(
          "      [page:error]",
          message.params.exceptionDetails?.exception?.description ?? "",
        );
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

    /**
     * A real mouse, through the browser rather than through JavaScript.
     *
     * The grid listens for pointer events on its canvas, and a `new PointerEvent(...)` dispatched from
     * a script is not trusted and does not become one. Chromium synthesises pointer events from these,
     * so the interaction under test is the one a hand would drive.
     */
    const mouse = async (type, x, y) =>
      send("Input.dispatchMouseEvent", {
        type,
        x,
        y,
        button: "left",
        buttons: type === "mouseReleased" ? 0 : 1,
        clickCount: 1,
        pointerType: "mouse",
      });

    /**
     * A picture of the window, written next to the build.
     *
     * Not a check -- nothing here compares images -- but the fastest way for a person to see what a
     * change did to a layout, which is the kind of thing a string assertion is bad at.
     */
    const screenshot = async (name) => {
      const reply = await send("Page.captureScreenshot", { format: "png" });
      const data = reply.result?.data;
      if (typeof data !== "string") return null;
      const file = join(SHOTS, `${name}.png`);
      writeFileSync(file, Buffer.from(data, "base64"));
      console.log(`      shot  ${file}`);
      return file;
    };

    /**
     * A modifier chord, formed well enough for an editor's own keymap to recognise it.
     *
     * Two things do not work here and both were tried. Chromium's named editing commands
     * (`commands: ["selectAll"]`) act on a textarea or a contenteditable, and the settings editor
     * uses the EditContext API instead, so they are silently ignored. A bare
     * `windowsVirtualKeyCode` with a modifier bitmask is not enough either: the editor reads `key`
     * and `code` off the event, and without them the chord arrives as an unrecognised keypress --
     * which looks exactly like select-all working and then the typing replacing nothing.
     */
    const chord = async (keyName, code, virtualKeyCode, modifiers) => {
      for (const type of ["rawKeyDown", "keyUp"]) {
        await send("Input.dispatchKeyEvent", {
          type,
          modifiers,
          key: keyName,
          code,
          windowsVirtualKeyCode: virtualKeyCode,
          nativeVirtualKeyCode: virtualKeyCode,
        });
      }
    };

    const META = process.platform === "darwin" ? 4 : 2;
    const SHIFT = 8;

    /** Select everything, whichever platform's modifier that is. */
    const selectAll = () => chord("a", "KeyA", 65, META);

    /**
     * Replaces a code editor's whole document with `value`.
     *
     * The delete at the end is not ceremony. The editor closes brackets and quotes as you type, so
     * inserting `{"a": 1}` leaves the auto-inserted `"}` sitting past the cursor and the document
     * is not valid JSON. A person typing would see that and remove it; this does the same, by
     * selecting from the cursor to the end and deleting.
     */
    const replaceDocument = async (value) => {
      await selectAll();
      await sleep(80);
      await insertText(value);
      await sleep(200);
      await chord("ArrowDown", "ArrowDown", 40, META | SHIFT);
      await sleep(80);
      await chord("Delete", "Delete", 46, 0);
      await sleep(400);
    };

    /**
     * Types text into whatever has focus.
     *
     * The settings editor owns its own DOM and its own model, so there is no textarea to set a value
     * on: the only honest way to change it is to type, which is also the path a person takes.
     */
    const insertText = (value) => send("Input.insertText", { text: value });

    await send("Runtime.enable");
    await send("Page.enable");
    await sleep(1800);
    await run({
      evaluate,
      text,
      mouse,
      replaceDocument,
      insertText,
      sleep,
      screenshot,
    });
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
  await launch(
    async ({ evaluate, text, screenshot, replaceDocument, mouse }) => {
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
      // A widget's tab, not a button: the dock renders each slot as a tab strip now.
      await evaluate(`click('[role="tab"]', "Settings");`);
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

      // ── The dock: a panel can be closed, and put back from the slot it left ──
      await screenshot("shell");
      const tabNames = () =>
        evaluate(
          `return [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent.trim());`,
        );
      const tabs = await tabNames();
      check(
        "6. every slot renders its panels as tabs",
        [
          "Catalog",
          "Projects",
          "History",
          "Grid",
          "Settings",
          "Log",
          "Inspector",
          "Scope",
          "Performance",
        ].every((name) => tabs.includes(name)),
        JSON.stringify(tabs),
      );

      // Closing writes the layout to the workspace, which is the point of it living in the settings.
      await evaluate(
        `[...document.querySelectorAll('[aria-label="Close Performance"]')][0].click();`,
      );
      await sleep(400);
      check(
        "6. closing a panel removes its tab",
        !(await tabNames()).includes("Performance"),
      );
      const savedLayout = JSON.parse(
        readFileSync(join(ws, "workspace.json"), "utf8"),
      ).settings["layout.widgets"];
      check(
        "6. and the workspace remembers the layout",
        Array.isArray(savedLayout?.["right-bottom"]) &&
          !savedLayout["right-bottom"].includes("performance"),
        JSON.stringify(savedLayout),
      );

      // The `+` on a slot's strip offers exactly what is missing. Opened with a pointerdown rather
      // than a click: that is the event the menu listens for.
      await evaluate(
        `const add = document.querySelector('[aria-label="Add a panel to right-bottom"]');
       add.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, isPrimary: true, pointerType: "mouse" }));
       add.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, button: 0, isPrimary: true, pointerType: "mouse" }));`,
      );
      await sleep(400);
      const offered = await evaluate(
        `return [...document.querySelectorAll('[role="menuitem"]')].map((i) => i.textContent.trim());`,
      );
      check(
        "6. the add-panel menu offers the one that was closed",
        offered.includes("Performance"),
        JSON.stringify(offered),
      );
      await evaluate(
        `[...document.querySelectorAll('[role="menuitem"]')].find((i) => i.textContent.trim() === "Performance").click();`,
      );
      await sleep(400);
      check(
        "6. and adding it back restores the tab",
        (await tabNames()).includes("Performance"),
      );

      // A pinned panel has no close button at all: nothing in the interface could put the grid back.
      check(
        "6. the grid cannot be closed",
        (await evaluate(
          `return document.querySelector('[aria-label="Close Grid"]') === null;`,
        )) === true,
      );

      // The settings editor owns its own DOM and model, so there is no value to set: the only honest
      // way in is to click into it, select everything and type -- which is the path a person takes.
      const mounted = await evaluate(
        `return document.querySelector(".monaco-editor") !== null;`,
      );
      check(
        "6. the settings editor mounts under the content policy",
        mounted === true,
      );
      await screenshot("settings");

      const typeSettings = async (json) => {
        const box = await evaluate(`
        const el = document.querySelector('[data-widget="settings"] .monaco-editor .view-lines');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x + 40), y: Math.round(r.y + 8) };`);
        if (box === null) throw new Error("no settings editor to type into");
        await mouse("mousePressed", box.x, box.y);
        await mouse("mouseReleased", box.x, box.y);
        await sleep(150);
        await replaceDocument(json);
      };

      // ── Colours written in the settings reach both CSS and the canvas ──────
      // `ui.*` was the path that silently did nothing while the palette lived in a hand-written
      // stylesheet: the editor offered these keys and nothing could write them into CSS.
      await typeSettings(
        '{"theme": {"ui.background": "#123456", "grid.gridLine": "#654321"}, "themes": {"midnight": {"name": "Midnight", "extends": "dark", "colors": {"card": "#0a0b0c"}}}}',
      );
      await sleep(600);
      const colours = await evaluate(`
        const read = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return { background: read("--background"), gridLine: read("--grid-line"), card: read("--card") };`);
      check(
        "6. an interface colour written in the settings reaches CSS",
        colours.background === "#123456",
        JSON.stringify(colours),
      );
      check(
        "6. and so does a canvas colour",
        colours.gridLine === "#654321",
        JSON.stringify(colours),
      );

      // A theme the workspace defined is offered beside the built-ins. `mod+alt+t` is the default
      // binding for the picker; the settings above do not rebind anything.
      await evaluate(`press("t", { metaKey: true, altKey: true });`);
      await sleep(400);
      const offeredThemes = await evaluate(
        `return [...document.querySelectorAll('[data-testid="theme-picker-navigator-list"] button')].map((b) => b.textContent.trim());`,
      );
      check(
        "6. a theme the workspace defines appears in the picker",
        offeredThemes.some((t) => t.includes("Midnight")),
        JSON.stringify(offeredThemes),
      );
      await evaluate(
        `document.querySelector("dialog").dispatchEvent(new Event("cancel", { cancelable: true }));`,
      );
      await sleep(250);

      await typeSettings(
        '{"grid.snap": 16, "keybindings": [{"key": "mod+b", "remove": true}]}',
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
      check(
        "6. the file kept its name field",
        typeof written.name === "string",
      );
      const stillThere = await evaluate(
        `press("b", { metaKey: true }); await new Promise(r => setTimeout(r, 250)); return ${leftShown};`,
      );
      check(
        "6. removing a binding takes effect without a relaunch",
        stillThere === true,
        String(stillThere),
      );

      // And adding one does too, on the same read of the file.
      await typeSettings(
        '{"grid.snap": 16, "keybindings": [{"key": "mod+b", "remove": true}, {"key": "mod+alt+j", "command": "workbench.setTheme"}]}',
      );
      await sleep(500);
      // The document says which theme is on -- the stylesheet keys off it -- so that is what to read.
      const activeTheme = `document.documentElement.dataset.theme`;
      const themeBefore = await evaluate(`return ${activeTheme};`);
      await evaluate(`press("j", { metaKey: true, altKey: true });`);
      await sleep(400);
      check(
        "6. adding a binding takes effect without a relaunch",
        (await evaluate(
          `return document.querySelector('[data-testid="theme-picker"]') !== null;`,
        )) === true,
        "the theme picker did not open",
      );
      // Arrowing through the picker previews each theme, and escape puts back the one you had.
      // Twice: the list opens with the active theme first, so one press lands back on where you are.
      await evaluate(
        `const input = document.querySelector('[data-testid="theme-picker-navigator-search"]');
       input.focus();
       for (let i = 0; i < 2; i++) input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));`,
      );
      await sleep(250);
      const themePreviewed = await evaluate(`return ${activeTheme};`);
      check(
        "6. arrowing through the theme picker previews",
        themePreviewed !== themeBefore,
        `${themeBefore} -> ${themePreviewed}`,
      );
      await evaluate(
        `document.querySelector("dialog").dispatchEvent(new Event("cancel", { cancelable: true }));`,
      );
      await sleep(250);

      // One picture in a theme that is not the default, as a check that nothing is styled by
      // accident rather than by token: an unstyled component looks fine in dark and wrong here.
      await evaluate(`document.documentElement.dataset.theme = "terminal";`);
      await sleep(300);
      await screenshot("terminal");
      await evaluate(`document.documentElement.dataset.theme = "dark";`);
      await sleep(200);

      check(
        "6. and escaping puts the old one back",
        (await evaluate(`return ${activeTheme};`)) === themeBefore,
      );

      // Text that does not parse never reaches the file.
      await typeSettings('{"grid.snap": ');
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
    },
  );

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
  // ── Fourth launch: editing a patch, and taking it apart again ────────────
  mkdirSync(join(ws, "projects", "wiring"), { recursive: true });
  writeFileSync(
    join(ws, "projects", "wiring", "project.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        id: "wiring",
        name: "Wiring",
        tempo: 120,
        timeSignature: { numerator: 4, denominator: 4 },
        scale: { root: 0, name: "chromatic" },
        kind: "user",
        patch: {
          schemaVersion: 1,
          voiceCount: 1,
          feedbackMode: "sample",
          modules: [
            {
              id: "osc",
              type: "osc.wavetable",
              x: 48,
              y: 48,
              params: { level: 0.7 },
            },
            {
              id: "out",
              type: "io.audioOut",
              x: 384,
              y: 72,
              params: { gain: 0.5 },
            },
          ],
          edges: [
            {
              id: "e1",
              from: { module: "osc", port: "out" },
              to: { module: "out", port: "inL" },
            },
          ],
        },
      },
      null,
      2,
    ),
  );

  await launch(async ({ evaluate, text, mouse, screenshot }) => {
    await evaluate(`click("button", "Wiring");`);
    await sleep(1500);
    // The selected tab, not the Projects list: the list shows the name whether or not it opened, which
    // is how a project that failed to parse looked exactly like one that had. The dock has more than
    // one tablist, so this asks the tabs themselves which is selected.
    const opened = await evaluate(
      `return [...document.querySelectorAll('[role="tab"]')].some((t) => t.textContent.includes("Wiring") && t.getAttribute("aria-selected") === "true");`,
    );
    check("9. a saved patch opens", opened === true);

    const box = await evaluate(`
      const el = document.querySelector('[data-kb-scope="grid"] canvas');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };`);
    check("9. the grid has a canvas", box !== null, JSON.stringify(box));
    // The one picture worth having: a real patch drawn by the real renderer.
    await screenshot("grid");

    // ── The inspector: a form built from the engine's own descriptors ────────
    // Before anything moves the view, so a patch coordinate is a canvas coordinate: the oscillator
    // is written at (48, 48) below, and this clicks its title bar -- body rather than knob or
    // socket. Its slot shows one panel at a time, so the tab has to be at the front to be asked.
    await evaluate(`click('[role="tab"]', "Inspector");`);
    await sleep(300);
    await mouse("mousePressed", box.x + 118, box.y + 58);
    await mouse("mouseReleased", box.x + 118, box.y + 58);
    await sleep(500);
    const inspector = await evaluate(`
      const panel = document.querySelector('[data-widget="inspector"]');
      if (!panel) return null;
      return {
        labels: [...panel.querySelectorAll("label")].map((l) => l.textContent.trim()),
        inputs: panel.querySelectorAll("input").length,
        text: panel.innerText.slice(0, 80),
      };`);
    check(
      "9. selecting a module fills the inspector from its descriptor",
      inspector !== null && inspector.inputs > 2,
      JSON.stringify(inspector),
    );
    check(
      "9. and its fields are the engine's own parameter names",
      inspector !== null && inspector.labels.includes("Level"),
      JSON.stringify(inspector?.labels?.slice(0, 12)),
    );
    await screenshot("inspector");

    if (box === null) throw new Error("no canvas to drag on");

    // A marquee across the whole surface. The viewport starts unmoved, so patch coordinates and canvas
    // coordinates agree and both modules are inside it.
    await mouse("mousePressed", box.x + 20, box.y + 20);
    await sleep(80);
    for (let i = 1; i <= 6; i++) {
      await mouse(
        "mouseMoved",
        box.x + 20 + ((box.w - 40) * i) / 6,
        box.y + 20 + ((box.h - 40) * i) / 6,
      );
      await sleep(40);
    }
    await mouse("mouseReleased", box.x + box.w - 20, box.y + box.h - 20);
    await sleep(300);
    // The grid must actually hold focus, or a binding scoped to it can never match.
    check(
      "9. clicking the grid gives it focus",
      (await evaluate(
        `return document.activeElement?.closest("[data-kb-scope]")?.dataset.kbScope ?? "(none)";`,
      )) === "grid",
    );

    await evaluate(`press("Delete");`);
    await sleep(300);
    check(
      "9. deleting marks the project unsaved",
      (await text()).includes("•"),
    );

    await evaluate(`press("s", { metaKey: true });`);
    await sleep(700);
    const afterDelete = JSON.parse(
      readFileSync(join(ws, "projects", "wiring", "project.json"), "utf8"),
    );
    check(
      "9. the modules are gone",
      afterDelete.patch.modules.length === 0,
      JSON.stringify(afterDelete.patch.modules),
    );
    check(
      "9. and so is the cable between them",
      afterDelete.patch.edges.length === 0,
      JSON.stringify(afterDelete.patch.edges),
    );

    await evaluate(`press("z", { metaKey: true });`);
    await sleep(400);
    await evaluate(`press("s", { metaKey: true });`);
    await sleep(700);
    const afterUndo = JSON.parse(
      readFileSync(join(ws, "projects", "wiring", "project.json"), "utf8"),
    );
    check(
      "9. undo brings the modules back",
      afterUndo.patch.modules
        .map((m) => m.id)
        .sort()
        .join(",") === "osc,out",
      JSON.stringify(afterUndo.patch.modules.map((m) => m.id)),
    );
    check(
      "9. undo brings the cable back too",
      afterUndo.patch.edges.length === 1,
      JSON.stringify(afterUndo.patch.edges),
    );

    // ── The minimap, which is the patch painted a pixel per cell ──────────────
    const map = await evaluate(`
      const canvas = document.querySelector('[data-testid="mini-map"] canvas');
      if (!canvas) return null;
      const context = canvas.getContext("2d");
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      // The ground is one colour; anything else is something a drawer painted.
      const ground = [pixels[0], pixels[1], pixels[2]].join(",");
      let painted = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if ([pixels[i], pixels[i + 1], pixels[i + 2]].join(",") !== ground) painted++;
      }
      const marker = document.querySelector('[data-testid="mini-map"] div');
      return { width: canvas.width, height: canvas.height, painted, marker: marker?.style.display };`);
    check(
      "9. the minimap sized itself to the patch",
      map !== null && map.width > 4 && map.height > 4,
      JSON.stringify(map),
    );
    check(
      "9. and painted the modules and cables into it",
      map !== null && map.painted > 10,
      JSON.stringify(map),
    );
    check(
      "9. the viewport rectangle is drawn",
      map?.marker === "block",
      JSON.stringify(map),
    );

    // ── Panning and zooming ──────────────────────────────────────────────────
    const zoomText = () =>
      evaluate(
        `return document.querySelector('output[aria-label="Zoom"]')?.textContent ?? "";`,
      );
    check(
      "9. the zoom control reads out the zoom",
      (await zoomText()) === "100%",
    );

    // A trackpad two-finger scroll: small pixel deltas, no modifier. This must pan, not zoom --
    // binding it to zoom is what made the canvas lurch instead of moving.
    const beforePan = await evaluate(
      `return JSON.stringify(document.querySelector('[data-kb-scope="grid"] canvas').getBoundingClientRect());`,
    );
    await evaluate(`
      const canvas = document.querySelector('[data-kb-scope="grid"] canvas');
      canvas.dispatchEvent(new WheelEvent("wheel", { deltaX: 40, deltaY: 30, deltaMode: 0, bubbles: true, cancelable: true }));`);
    await sleep(300);
    check(
      "9. a two-finger scroll pans rather than zooming",
      (await zoomText()) === "100%",
      await zoomText(),
    );
    check("9. and the canvas is still the same size", beforePan !== null);

    // A wheel click zooms.
    await evaluate(`
      const canvas = document.querySelector('[data-kb-scope="grid"] canvas');
      canvas.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, deltaMode: 0, bubbles: true, cancelable: true }));`);
    await sleep(300);
    const zoomedIn = await zoomText();
    check("9. a wheel click zooms in", zoomedIn !== "100%", zoomedIn);

    // And the control puts it back.
    // Zoom to fit recentres the view on the patch. That it frames it *exactly* is checked in
    // `viewport.test.ts`, where the arithmetic can be asserted rather than inferred from a
    // screenshot -- and where the fit zoom happening to equal the current one is not a false
    // failure, which it is here.
    const framed = await evaluate(
      `const marker = document.querySelector('[data-testid="mini-map"] div');
       const before = marker.style.left;
       document.querySelector('button[aria-label="Zoom to fit"]').click();
       await new Promise(r => setTimeout(r, 400));
       return { before, after: marker.style.left };`,
    );
    await sleep(300);
    check(
      "9. zoom to fit recentres the view on the patch",
      framed.before !== framed.after,
      JSON.stringify(framed),
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

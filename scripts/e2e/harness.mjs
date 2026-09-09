/**
 * Launches the built application and hands a scenario the means to drive it.
 *
 * Every launch is headless in the sense that matters: a throwaway user-data directory, a throwaway
 * workspace named on the command line, and the engine on its silent backend, so a run touches
 * nothing of the person's and makes no sound. What the scenario gets back is a driver: the DevTools
 * protocol for a real pointer, keyboard and pictures, `pg` for everything that has a name, and a
 * few helpers that have earned their place.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connect, findPage } from "./cdp.mjs";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
/** One line per assertion. A failure prints what it saw, because "FAIL" alone is a mystery. */
export function check(label, condition, extra = "") {
  if (!condition) failures++;
  console.log(
    `${condition ? "  ok" : "FAIL"}  ${label}${extra && !condition ? ` — ${extra}` : ""}`,
  );
  return condition;
}
export const failureCount = () => failures;

/**
 * Polls `predicate` until it answers something truthy, and returns it.
 *
 * For the conditions that are not in the page: a file appearing, a file saying what it should. The
 * ones inside the window have `waitFor` on the driver instead.
 */
export async function until(
  predicate,
  { timeoutMs = 8000, intervalMs = 50, label = "the condition" } = {},
) {
  const started = Date.now();
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() - started > timeoutMs)
      throw new Error(`until: ${label} did not happen within ${timeoutMs} ms`);
    await sleep(intervalMs);
  }
}

/**
 * The engine process an application spawned, found by the telemetry segment it was told to write.
 *
 * The segment is named for the main process that owns it, so this picks out one application's
 * engine with several running: another scenario's, or a development session's. Matched on the whole
 * argument rather than as text, because `/pg-123` is a substring of `/pg-1234`.
 *
 * Null when there is no such process, which is itself worth asserting: it is how a scenario knows
 * the engine really did die.
 */
export function engineProcessId(shmName) {
  const listing = execFileSync("ps", ["-ax", "-o", "pid=,command="], {
    encoding: "utf8",
  });
  for (const line of listing.split("\n")) {
    if (!line.includes("phasegrid-engine")) continue;
    const parts = line.trim().split(/\s+/);
    const at = parts.indexOf("--shm");
    if (at < 0 || parts[at + 1] !== shmName) continue;
    const pid = Number(parts[0]);
    if (Number.isInteger(pid)) return pid;
  }
  return null;
}

export const newWorkspace = () => mkdtempSync(join(tmpdir(), "pg-ws-"));
export const newUserData = () => mkdtempSync(join(tmpdir(), "pg-ud-"));

/** Puts a project on disk where the application will list it. */
export function seedProject(workspace, slug, doc) {
  mkdirSync(join(workspace, "projects", slug), { recursive: true });
  writeFileSync(
    join(workspace, "projects", slug, "project.json"),
    `${JSON.stringify(doc, null, 2)}\n`,
  );
}

/** The smallest project document the application reads. */
export function projectDoc(overrides = {}) {
  return {
    schemaVersion: 1,
    id: overrides.id ?? "seeded",
    name: overrides.name ?? "Seeded",
    tempo: overrides.tempo ?? 120,
    timeSignature: { numerator: 4, denominator: 4 },
    scale: { root: 0, name: "chromatic" },
    kind: "user",
    patch: overrides.patch ?? {
      schemaVersion: 1,
      voiceCount: 1,
      feedbackMode: "sample",
      modules: [],
      edges: [],
    },
  };
}

/** Helpers evaluated inside the page before every `evaluate`. Small on purpose. */
const HELPERS = `
const setValue = (el, value) => {
  if (!el) throw new Error("no element to set");
  const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const press = (key, mods = {}) => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods }));
const byText = (selector, text) => [...document.querySelectorAll(selector)].find((e) => e.textContent.trim() === text);
const click = (selector, text) => { const el = byText(selector, text); if (!el) throw new Error("no element: " + text); el.click(); };
// Scoped to the projects list: a project called "Modulation" or "Scope" shares its name with a
// catalogue heading or module, and a click by text alone would land on whichever comes first.
const openProject = (name) => click('[data-testid="projects"] button', name);
`;

let nextPort = 9400 + Math.floor(Math.random() * 400);

/**
 * Wraps a connected page in the driver a scenario uses.
 *
 * `shots` is where `screenshot` writes; `label` prefixes the page's console lines so two apps in one
 * log can be told apart.
 */
async function makeDriver(url, { shots, label = "page" }) {
  /**
   * Everything the page reported as an error, and the patterns a scenario said to expect.
   *
   * This exists because of a bug that hid here. A batch the engine refused was logged, the sync
   * layer recovered by resending the whole patch, and the run passed: the only trace was a line in
   * the scroll-back that nothing was looking at. An application that recovers from its own errors
   * is a good application and a bad test subject, so the errors are collected and a scenario fails
   * on any it did not say to expect. The log store echoes engine errors to the console, so this
   * catches the engine's as well as the renderer's.
   */
  const errors = [];
  const expected = [];

  const cdp = await connect(url, {
    onConsole: (type, text) => {
      console.log(`      [${label}:${type}] ${text}`);
      if (type === "error") errors.push(text);
    },
  });
  const evaluate = (source) => cdp.evaluate(source, HELPERS);
  const text = () => evaluate("return document.body.innerText;");

  /**
   * Waits until `source`, evaluated in the page, is truthy, and returns what it evaluated to.
   *
   * `source` is an expression: `'document.querySelector("dialog") !== null'`, or anything reaching
   * `window.pg`. This is what replaces a sleep. A sleep says how long someone guessed the thing
   * takes on the machine they wrote it on; this says what is being waited for, and fails saying so.
   */
  const waitFor = async (
    source,
    { timeoutMs = 8000, intervalMs = 50, label } = {},
  ) => {
    const started = Date.now();
    for (;;) {
      let value;
      try {
        value = await evaluate(`return (${source});`);
      } catch {
        // A condition that cannot even be evaluated yet -- a store not built, an element not there
        // -- is simply not true yet. It becomes a timeout if it stays that way.
        value = undefined;
      }
      if (value) return value;
      if (Date.now() - started > timeoutMs)
        throw new Error(
          `waitFor: ${label ?? source} was not true within ${timeoutMs} ms`,
        );
      await sleep(intervalMs);
    }
  };

  /**
   * An assertion that is allowed to take a moment: waits for `source`, then reports it as a check.
   *
   * The difference from `waitFor` matters. `waitFor` is for getting somewhere -- a dialog to be
   * open before typing into it -- and throwing is the right failure. This is for the assertion
   * itself, so a slow machine does not turn a true statement into a failed one, and a false one
   * still prints as a FAIL line beside its neighbours rather than ending the scenario.
   */
  const checkEventually = async (labelText, source, options = {}) => {
    try {
      await waitFor(source, options);
      return check(labelText, true);
    } catch {
      return check(labelText, false, `never became true: ${source}`);
    }
  };

  /**
   * Runs an expression against `window.pg`, the application's automation API, and returns its
   * value. `pg("snapshot().engine")` is `await window.pg.snapshot().engine` in the page.
   */
  const pg = (expression) =>
    cdp.evaluate(`return await (window.pg.${expression});`);
  /** Waits until the application has nothing in flight. Sleep's replacement. */
  const idle = () => cdp.evaluate("return await window.pg.idle();");

  /**
   * A real mouse, through the browser rather than through JavaScript.
   *
   * The grid listens for pointer events on its canvas, and a `new PointerEvent(...)` dispatched from
   * a script is not trusted and does not become one. Chromium synthesises pointer events from these,
   * so the interaction under test is the one a hand would drive.
   */
  const mouse = (type, x, y) =>
    cdp.send("Input.dispatchMouseEvent", {
      type,
      x,
      y,
      button: "left",
      buttons: type === "mouseReleased" ? 0 : 1,
      clickCount: 1,
      pointerType: "mouse",
    });
  const clickAt = async (x, y) => {
    await mouse("mousePressed", x, y);
    await mouse("mouseReleased", x, y);
  };
  const dragTo = async (from, to, steps = 6) => {
    await mouse("mousePressed", from.x, from.y);
    await sleep(60);
    for (let i = 1; i <= steps; i++) {
      await mouse(
        "mouseMoved",
        from.x + ((to.x - from.x) * i) / steps,
        from.y + ((to.y - from.y) * i) / steps,
      );
      await sleep(30);
    }
    await mouse("mouseReleased", to.x, to.y);
  };

  /**
   * A picture of the window. Not a check -- nothing compares images -- but the fastest way for a
   * person, or an agent that can read one, to see what a change did to a layout.
   */
  const screenshot = async (name) => {
    const reply = await cdp.send("Page.captureScreenshot", { format: "png" });
    const data = reply.result?.data;
    if (typeof data !== "string") return null;
    mkdirSync(shots, { recursive: true });
    const file = join(shots, `${name}.png`);
    writeFileSync(file, Buffer.from(data, "base64"));
    console.log(`      shot  ${file}`);
    return file;
  };

  /**
   * A modifier chord, formed well enough for an editor's own keymap to recognise it.
   *
   * Two things do not work here and both were tried. Chromium's named editing commands act on a
   * textarea or a contenteditable, and the settings editor uses the EditContext API instead, so
   * they are silently ignored. A bare `windowsVirtualKeyCode` with a modifier bitmask is not enough
   * either: the editor reads `key` and `code` off the event.
   */
  const chord = async (keyName, code, virtualKeyCode, modifiers) => {
    for (const type of ["rawKeyDown", "keyUp"]) {
      await cdp.send("Input.dispatchKeyEvent", {
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
  const selectAll = () => chord("a", "KeyA", 65, META);
  /** Types text into whatever has focus. The only honest way into an editor that owns its DOM. */
  const insertText = (value) => cdp.send("Input.insertText", { text: value });
  /**
   * Replaces a code editor's whole document with `value`. The delete at the end removes the closing
   * bracket the editor auto-inserted past the cursor, as a person would.
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

  /** Where the open workspace is, asked of the application rather than assumed. */
  const workspaceRoot = () =>
    evaluate(
      "const c = await window.workspace.current(); return c.ok ? c.value?.root ?? null : null;",
    );

  return {
    cdp,
    evaluate,
    text,
    pg,
    idle,
    waitFor,
    checkEventually,
    /** Errors matching any of these are the scenario's business, not a failure. */
    expectErrors: (...patterns) => expected.push(...patterns),
    /** Everything the page reported as an error, expected or not. */
    errors: () => [...errors],
    unexpectedErrors: () =>
      errors.filter(
        (message) =>
          !expected.some((pattern) =>
            pattern instanceof RegExp
              ? pattern.test(message)
              : message.includes(pattern),
          ),
      ),
    mouse,
    clickAt,
    dragTo,
    chord,
    selectAll,
    insertText,
    replaceDocument,
    screenshot,
    workspaceRoot,
    sleep,
    check,
  };
}

/**
 * Starts the built application and runs `run` against it.
 *
 * Options: `workspace` (a folder; opened for this launch, never remembered; omit to see the gate),
 * `userData` (fresh by default), `audio` (`"null"` by default), `shots`, `keep` (leave it running
 * afterwards and print how to reach it), `args` (anything else for Electron).
 */
export async function launch(options, run) {
  const {
    workspace = null,
    userData = newUserData(),
    audio = "null",
    shots = mkdtempSync(join(tmpdir(), "pg-shot-")),
    keep = false,
    args = [],
    label = "page",
  } = options;
  // A fresh port per launch, and its own process group. Electron leaves helper processes behind
  // when the main process is killed, and one of those still holding the port is indistinguishable
  // from the next launch answering.
  const port = nextPort++;
  const argv = [
    ".",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userData}`,
    ...(workspace === null ? [] : ["--workspace", workspace]),
    ...(audio === null ? [] : ["--audio", audio]),
    ...args,
  ];
  const app = spawn(resolve(ROOT, "node_modules/.bin/electron"), argv, {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const forward = (b) => {
    const line = String(b);
    // Chromium's own chatter, not ours.
    if (/DevTools listening|Secure coding is not enabled/.test(line)) return;
    process.stderr.write(`[app] ${line}`);
  };
  app.stdout.on("data", forward);
  app.stderr.on("data", forward);

  let driver = null;
  try {
    const url = await findPage(port);
    if (url === null) throw new Error("no debuggable page appeared");
    driver = await makeDriver(url, { shots, label });
    // The renderer's first paint, the engine handshake and the workspace boot all race the
    // debugger attaching; a scenario that needs a precise condition waits on it with `idle`.
    await sleep(1800);
    await run({ ...driver, port, userData, workspace, shots });
  } finally {
    reportErrors(driver);
    driver?.cdp.close();
    if (keep) {
      console.log(
        `\nkept running: port ${port}, userData ${userData}, workspace ${workspace ?? "(none)"}\n` +
          `  node scripts/drive.mjs --port ${port} 'pg.snapshot()'`,
      );
    } else {
      try {
        process.kill(-app.pid, "SIGKILL");
      } catch {
        app.kill("SIGKILL");
      }
      await sleep(600);
    }
  }
}

/** Runs `run` against an application already listening on `port`: a development session, say. */
export async function attach(port, run, { shots, label = "page" } = {}) {
  const url = await findPage(port, 4, 250);
  if (url === null)
    throw new Error(
      `nothing is listening on port ${port}; start the app with --remote-debugging-port=${port}`,
    );
  const driver = await makeDriver(url, {
    shots: shots ?? mkdtempSync(join(tmpdir(), "pg-shot-")),
    label,
  });
  try {
    await run({
      ...driver,
      port,
      userData: null,
      workspace: await driver.workspaceRoot(),
      shots,
    });
  } finally {
    reportErrors(driver);
    driver.cdp.close();
  }
}

/**
 * The check every scenario gets whether it asked for one or not.
 *
 * Reported in the `finally`, so a scenario that threw still says what the page was complaining
 * about -- which is usually the reason it threw.
 */
function reportErrors(driver) {
  if (driver === null || driver === undefined) return;
  const unexpected = driver.unexpectedErrors();
  check(
    "nothing errored that the scenario did not expect",
    unexpected.length === 0,
    unexpected.join(" | "),
  );
}

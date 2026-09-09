# Automation

phasegrid2 can be driven by name. `window.pg` is an API over the whole application, always on; the
DevTools protocol gives a real mouse, keyboard and screenshots; two scripts tie them together. This
is how an agent verifies a change without a person, and how a person scripts the application.

## Running the application for a script

Three flags, beside Chromium's own:

| Flag | What it does |
| --- | --- |
| `--workspace <dir>` | Opens that folder for this launch. It overrides the remembered pointer and is never written to it. |
| `--audio <id\|null>` | The engine's device. `null` is miniaudio's null backend: real-time timing, no hardware, no sound. |
| `--remote-debugging-port=<n>` | Chromium's: the DevTools protocol on that port. |

`npm run dev:drive` is `npm run dev -- --audio null --remote-debugging-port=9222`: a development
session a script can attach to. `scripts/dev.mjs` passes anything after its own name to Electron.

A development session hot-reloads only the renderer. After a change to `engine/`, `src/main`,
`src/preload` or `shared/protocol`, restart it, or the renderer runs against an older main and engine
and the failure looks like something else.

## `window.pg`

Every function answers plain data, so a debugger's `returnByValue` carries it and it prints as it
is. `pg.help()` lists them.

- **`snapshot(logTail?)`** — everything at once: `workspace` (status, root, name, projects, error),
  `projects` (open tabs with id, name, slug, kind, dirty, tempo; `activeId`), `patch` (the document),
  `selection`, `engine` (status, detail, version, revision, running, capabilities, hasTelemetry),
  `transport` (playing), `catalog` (status, count, hash), `history` (past and future labels),
  `config` (computed settings), `layout` (widgets per slot, visibility), `modals`, `theme`, `log`.
- **`stores.<name>.getState()`** — the zustand stores: `patch`, `project`, `selection`, `engine`,
  `catalog`, `history`, `config`, `layout`, `widgets`, `workspace`, `theme`, `modal`, `transport`,
  `log`. For anything the snapshot does not summarise, and for calling store actions directly.
- **`idle()`** — resolves when every document edit has reached the engine, the catalogue is loaded,
  the telemetry subscription has answered, and two frames have painted. Use it where a sleep would go.
  **`waitFor(() => cond, {timeoutMs, label})`** polls anything else.
- **`commands.list()` / `commands.run(id, payload?)`** — the command registry: what the palette runs.
- **`patch.addModule(type, {id, x, y}?)`**, **`patch.connect(from, to)`**, **`patch.setParam(module,
  param, value)`**, **`patch.remove(ids)`**, **`patch.select(ids)`**, **`patch.apply(ops, label?)`** —
  edits by the path the catalogue and the canvas take: undoable, and sent to the engine.
- **`grid.canvas()`**, **`grid.viewport()`**, **`grid.node(id)`** (rect and a title point),
  **`grid.nodes()`**, **`grid.port(module, port, side?)`**, **`grid.knob(module, param)`** — where
  things are, in window CSS pixels, ready for a real pointer event. Null when there is no such thing.
- **`workspace.openAt(root)`**, **`openProject(slug)`**, **`save()`**, **`saveAs(name)`**,
  **`closeProject(id?)`**, **`openExample(moduleId)`**.
- **`dialogs.answer(kind, answer)`** — the next native dialog of that kind returns this instead of
  showing: `confirmUnsaved` takes `"save" | "discard" | "cancel"`, `confirmDelete` a boolean,
  `chooseWorkspace` a path (which must exist) or null. Consumed once.
- **`engine.call(cmd, args)`** — the protocol, raw. **`engine.render({seconds, out}?)`** — the loaded
  patch rendered offline by a second engine and measured: `rms` and `peak` per channel, `frames`,
  and a WAV at `out` when given. The engine that is playing is untouched.
- **`log.tail(n)`**, **`log.clear()`** — what the engine and the application have said. The same
  lines go to the console, so a debugger's console tap sees engine output.

In the developer console: `await pg.snapshot()`, `await pg.commands.run("project.new")`.

## The scripts

**`node scripts/drive.mjs [--port n] [expr]`** — one expression against a running application,
printed as JSON; `--text` for the window's text; `--shot file.png` for a picture; with nothing, a
REPL. The expression runs in the page with `pg` and the `window.*` bridges in scope and is awaited.

```
node scripts/drive.mjs 'pg.snapshot().engine'
node scripts/drive.mjs 'pg.patch.addModule("osc.sine")'
node scripts/drive.mjs 'pg.grid.knob("sine", "fold")'
node scripts/drive.mjs --shot /tmp/now.png
```

**`node scripts/e2e.mjs`** — the scenarios, each against a freshly launched application in a
throwaway workspace and user-data directory, silent. `npm run e2e` builds first. `--only a,b` runs
some; `--list` names them; `--shots <dir>` says where pictures go; `--keep` leaves the last
application running and prints its port; `--attach <port>` runs against an application already
listening (scenarios that launch the application themselves are skipped).

A scenario is a module under `scripts/e2e/scenarios/` exporting `{ name, description, run(driver) }`,
plus `seed(workspace)` to put files in the folder first, or `launches: true` to start the application
itself and get `launch` instead of a driver. The driver has `pg(expr)`, `idle()`, `evaluate(js)`,
`text()`, `clickAt`, `dragTo`, `mouse`, `chord`, `insertText`, `replaceDocument`, `screenshot(name)`,
`check(label, condition, detail)` and the workspace path, plus the three below.

**Scenarios do not sleep.** A sleep says how long someone guessed something takes on the machine
they wrote it on, which is a failure waiting for a slower one. Two helpers replace it, and both take
an expression evaluated in the page:

- `waitFor(source, {timeoutMs, label})` waits to get somewhere: a dialog open before typing into it,
  a project saved before reading its file. A timeout throws, naming the label.
- `checkEventually(label, source)` is the assertion itself, allowed to take a moment. It prints an
  ok or FAIL line like `check` rather than ending the scenario, so a slow machine does not turn a
  true statement into a failure.
- `until(predicate, {label})`, imported from the harness, is the same thing for conditions outside
  the page: a file appearing, a file saying what it should.

Wait on the slowest thing that has to be true, and assert the rest. The zoom readout is polled five
times a second by design, so a check that reads it immediately after the viewport moved is racing
something deliberate.

**Killing the engine.** `engineProcessId(shmName)`, from the harness, finds the engine process an
application spawned, identified by the telemetry segment it was told to write
(`pg.stores.engine.getState().shm.name`). A scenario can `process.kill` it and watch the supervisor
put it back. That is the only way to exercise restart, back-off and the resend of the whole patch
against a genuinely dead process: `engine.shutdown` over the protocol is a clean exit the supervisor
deliberately does not restart. See `scripts/e2e/scenarios/engine-restart.mjs`.

**Every scenario fails on an unexpected error.** The harness collects everything the page reports as
an error, the engine's included, since the log store echoes those to the console. Any that a
scenario did not declare fails it. This exists because an application that recovers from its own
errors is a good application and a bad test subject: a batch the engine refused was logged, the
sync layer resent the whole patch, and the run passed with the fault visible only in the
scroll-back. Declare an expected one with `expectErrors(/pattern/)`, and read them with `errors()`.

## What the protocol is still for

`pg` is the semantic layer. The DevTools protocol does what only a browser can:

- A real pointer. The canvas listens for pointer events and a `PointerEvent` made in script is not
  trusted. `Input.dispatchMouseEvent` at coordinates from `pg.grid` is a real click on a real knob.
- Typing into the settings editor. It owns its own DOM and model and uses the EditContext API, so
  there is no value to set: click into it, select all, type. `replaceDocument` does that dance.
- Pictures. `Page.captureScreenshot` is 2x on a retina display; CSS coordinates are pixel / 2.

## Gotchas

- `--attach` runs a scenario against the application as it is, tabs and all. The scenarios in the
  repository assume a fresh workspace, so most of their checks are about state an attached
  application does not start from; attach is for a scenario written for it, or for `drive`.

- `pg.idle()` covers document edits, the catalogue and settings writes, but not timers of the
  application's own: the session file is written on a debounce, so wait for it with `until`.
- `Input.insertText` into the command palette does not land; click a row.
- A module added at a default position may land past the canvas edge; give it `x` and `y`, or
  `commands.run("view.zoomToFit")` if there is one, or read `grid.nodes()` and pan.
- Read `grid` geometry immediately before clicking it. A coordinate is only true at the moment it
  was asked for, and anything that moves or resizes a panel in between sends the press somewhere
  else. The symptom is a gesture that silently does nothing.
- Chromium's named editing commands (`selectAll`) act on a textarea or contenteditable; the settings
  editor is neither. The chord helper sends `key` and `code` as the editor's keymap wants.

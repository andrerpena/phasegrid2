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
  **`grid.nodes()`**, **`grid.port(module, port, side?)`** (a socket's centre and which way it faces),
  **`grid.knob(module, param)`** (its centre, and `live`: where modulation has it this frame, 0..1,
  or null with nothing in its socket — the way a script sees a knob turn), **`grid.face(module)`**
  (every block on the module, the title first and then the face's in reading order: kind, the name
  the engine gave it, its rect, its socket, a knob's centre and `live`, and a scope's `trace`: the
  engine's count of the last window drawn, its frames and its peak, and a readout's `reading`: the
  same count and the value per channel, both null before the first; an `adsr` block's `envelope`:
  where each stage ends and the level it sustains at, as fractions of the drawn width, and the
  `playhead` that moves along it while a note sounds; a `select` block's `choice`: the value it is
  showing and its label) — where things
  are, in window CSS pixels, ready for a real pointer event. Null when there is no such thing.
- **`workspace.openAt(root)`**, **`openProject(slug)`**, **`save()`**, **`saveAs(name)`**,
  **`closeProject(id?)`**, **`copyExample(moduleId)`** (copies a module's example into the workspace
  and opens the copy; resolves to whether it reached disk).
- **`dialogs.answer(kind, answer)`** — the next native dialog of that kind returns this instead of
  showing: `confirmUnsaved` takes `"save" | "discard" | "cancel"`, `confirmDelete` a boolean,
  `chooseWorkspace` a path (which must exist) or null. Consumed once.
- **`engine.call(cmd, args)`** — the protocol, raw. **`engine.render({seconds, out}?)`** — the loaded
  patch rendered offline by a second engine and measured: `rms`, `peak` and `maxStep` per channel,
  `frames`, and a WAV at `out` when given. The engine that is playing is untouched.
  `maxStep` is the largest jump from one sample to the next, and it is how a script hears a click: a
  wave's own slope bounds it, so a sine at middle C steps by hundredths and anything near full scale is
  a discontinuity. `rms` and `peak` cannot tell — a signal made of clicks has ordinary values for both.
  `crest` is peak over RMS, the wave's shape rather than its loudness: 1.41 a sine, 1.73 a sawtooth, 1 a
  square. It is how a script hears *distortion*, which has an ordinary level and no discontinuity at all;
  read it on a single voice, since a chord has no one shape. Waveform assertions proper live in the
  engine tests, where the note being played is known: see `engine/tests/test_osc_purity.cpp`.
  The render runs under the engine's own transport — its tempo, meter and scale — so it is the
  performance the instrument is giving, not the same patch at some other speed, and it takes the same
  code path as the device callback, ticking the clock once per engine block.
- **`engine.call("audio.capture.start", { path })`** / **`"audio.capture.stop"`** — record what the
  device is actually handed, to a WAV, until stopped; stop answers `frames` and `droppedFrames`. This is
  the live output, not a render: the `live-capture` scenario records the null device while a pattern
  plays and measures the file. **`engine.call("engine.stats", {})`** — `clockDiscontinuities` (must be
  0 after playing), `deviceClips` (samples the boundary clamped to full scale: a patch that is too loud),
  `blockSize`, `periodFrames` (the callback size the device granted). `engine.render` reports
  `deviceClips` too; its WAV never holds a sample over one, so this is how a script learns the patch
  asked for more.
- **`commands.run("project.toggleSource")`** — the project as the JSON that Save writes, in an editor,
  or the grid again; `snapshot().projects.open[].view` says which. **`commands.run("project.revealFile")`**
  — the project's file in the system file manager; a no-op for a project never saved.
  `stores.project.getState().replace(id, doc)` is what applying an edit from the source view runs.
- Measuring, outside the app: `npm run audio:measure -- a.wav [b.wav]` prints level, continuity
  (`maxStep`) and shape (crest, harmonics, THD) for one file or two side by side; `npm run
  render:example -- <moduleId> [--bars 2] [--set m.p=v] [--period 512]` renders a built-in example and
  measures it; `npm run compare:reference [-- module[/case]]` renders every case under
  `fixtures/reference/` and prints its features against the reference instrument's recording. The
  engine's `--render` takes `--tempo`, `--bars`, `--period` and repeatable `--set module.param=value`.
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

A driven application keeps drawing when its window is hidden or behind another: a debugging port
switches off Electron's background throttling. Without that a covered window gets no animation
frames, the canvas ticker stops, a modulated knob freezes on the canvas, and `pg.idle()`, which
waits for a frame, never returns. A project opens with the transport stopped, and a held patch has
nothing live: a scenario that wants to see a knob turn runs `transport.play` first.

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

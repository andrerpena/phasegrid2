# Agent operability

How an agent verifies a change to phasegrid2 without a person at the keyboard.

## The problem

The unit tests are strong: vitest over the stores and the protocol, 160 Catch2 tests, and every module
example rendered by the real engine and measured. End to end, though, there was one 1000-line script
driving the built application over the Chrome DevTools Protocol: four launches, forty-odd fixed sleeps,
assertions on `innerText`, canvas clicks at hand-computed pixel offsets, and native dialogs sidestepped
by calling the bridge directly. It passed, in 36 seconds, and it could check only what it could see —
which, for an application whose main surface is a Pixi canvas and whose state lives in zustand stores,
was very little.

Nine things stood between an agent and "test any change":

1. The canvas is opaque. Pixi has no DOM, so finding a module, port or knob meant redoing the layout
   arithmetic and hoping the viewport had not moved.
2. State is invisible. Patch, selection, projects, dirty flags, engine status, undo stack, config and
   layout were in stores nothing exposed.
3. Actions are indirect. Commands exist by id but were reached by key chords or by finding buttons by
   text; play/stop was component state with no store and no command.
4. No idle signal. Engine sync is a promise queue, telemetry subscribes behind it, the catalogue arrives
   after the handshake; tests slept.
5. The engine needed a real audio device, so no CI and no headless run.
6. Native dialogs could not be answered.
7. Engine logs went nowhere: the Log panel was a stub.
8. Nothing could hear. A patch built through the interface could not be checked for sound.
9. The harness was one file with no way to run one scenario, keep the app open, or attach to a running
   development session.

## The decision

An automation API in the product, always on. phasegrid2 is a tool for people who script things, and an
API that lets anyone drive it is a feature, not test code. The old rule — "no test-only code in the
product" — is retired; what replaces it is "anything a person can do has a name an agent can call".

The semantic layer lives in the renderer as `window.pg` and is reached over the DevTools protocol's
`Runtime.evaluate`. CDP keeps what it is uniquely good at: a real mouse and keyboard, and screenshots.
`pg` is a plain object of async functions returning JSON, so it could later be served over a socket to
clients that are not a browser debugger.

## `window.pg`

- `snapshot()` — the whole picture in one JSON object: workspace, open projects and which is active,
  the patch document, the selection, engine status and revision, transport, catalogue, undo history
  labels, computed config, layout, open modals, active theme, and the tail of the log.
- `stores` — the zustand stores themselves, for what the snapshot does not summarise.
- `commands.list()` / `commands.run(id, payload?)` — the command registry.
- `patch.apply(ops, label?)`, `patch.addModule(type, opts?)`, `patch.connect(from, to)`,
  `patch.setParam(module, param, value)` — edits by the same path the catalogue and the canvas take, so
  they are undoable and reach the engine.
- `grid.canvas()`, `grid.node(id)`, `grid.port(id, port)`, `grid.knob(id, param)`, `grid.nodes()`,
  `grid.viewport()` — geometry in window CSS pixels, ready for a real pointer event.
- `idle()` — resolves when the engine sync queue has drained, the catalogue is loaded, the telemetry
  subscription has answered, no settings save is pending, and two frames have painted. `waitFor(fn)`
  polls anything else.
- `workspace.openAt(root)`, `openProject(slug)`, `save()`, `saveAs(name)`, `closeProject(id)`,
  `openExample(moduleId)`.
- `dialogs.answer(kind, answer)` — the next native dialog of that kind returns this instead of showing.
- `engine.call(cmd, args)` — the raw protocol; `engine.render({seconds, out?})` — renders the loaded
  patch offline and reports RMS and peak per channel, so a patch can be checked for sound.
- `log.tail(n)` — engine log, supervisor warnings, renderer errors.
- `help()` — the list, one line each.

## Launch flags

`--workspace <dir>` opens that folder for this launch without touching the remembered pointer.
`--audio <id|null>` chooses the engine's device; `null` is a silent backend with real-time timing
(miniaudio's own null backend), so the application runs on a machine with no sound hardware and in CI.
`--remote-debugging-port` is Chromium's. `npm run dev -- --audio null --remote-debugging-port=9222`
forwards all three to a development session.

## In the product

- A transport store with `transport.play`, `transport.stop`, `transport.toggle` commands; the project
  header is a view of it.
- A log store, a bounded ring fed by engine events and renderer errors, shown in the Log panel, read by
  `pg.log`, and echoed to the console so a debugger's console tap sees engine output.
- A grid registry holding the live renderer, the way `viewport-store` holds the viewport.
- `flushSync()` in engine sync, so "everything sent" is a promise rather than a sleep.
- A `DialogHost` in the main process with a native and a scripted implementation, answers queued over
  the workspace channel.
- `patch.render` on the engine: the loaded model serialised into a fresh `Engine`, rendered by the
  offline renderer, measured, optionally written as a WAV. The live engine is untouched.

## The harness

`scripts/e2e/harness.mjs` launches the built application headless in a throwaway workspace and user
data directory and provides the CDP client and the helpers. One scenario per file under
`scripts/e2e/scenarios/`. `scripts/e2e.mjs` runs them all or `--only <name>`, keeps the application up
with `--keep`, writes pictures with `--shots`, and runs against a running application with `--attach`.
`scripts/drive.mjs` evaluates one expression, or opens a REPL, against a running application — a
development session started with a debugging port — which is how an agent explores.

`docs/automation.md` is the reference; the "Testing a change" section of `CLAUDE.md` is the recipe.

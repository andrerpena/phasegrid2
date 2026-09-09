# CLAUDE.md

phasegrid2 is a generative, grid-based modular music platform (Bitwig Grid-like). AGPL-3.0.
Spec: docs/superpowers/specs/2026-09-07-phasegrid2-architecture-design.md. Engine rules: docs/engine.md. Protocol: docs/protocol.md. Telemetry: docs/telemetry.md. Workspace and saving: docs/workspace.md. The interface — theme, dock, widgets, settings, minimap: docs/ui.md.

## Commands
- `npm run dev` — build engine (incremental) and start Electron with HMR
- `npm run typecheck && npm run lint:fix` — REQUIRED after any TypeScript change
- `npm test` — vitest unit project
- `npx electron-vite build && node scripts/e2e.mjs` — drives the built app over CDP through the workspace, the dock, the settings editor and the canvas. `PG_E2E_SHOTS=<dir>` writes screenshots there.
- `npm run engine:build` / `npm run engine:test` — CMake build and Catch2 tests; REQUIRED after any C++ change
- `npm run engine:render -- patch.json --seconds 2 --out out.wav` — headless render

## Layout
- `engine/` C++20 audio engine (separate process). `src/core` graph/scheduler, `src/modules` one file per module, `src/services` device/midi/telemetry/socket, `tests/` Catch2.
- `src/main/workspace/` the workspace folder: path guard, filesystem, dialogs, one IPC channel.
- `native/` N-API shared-memory reader (phase 5).
- `shared/` protocol schemas shared by main/preload/renderer.
- `src/main`, `src/preload`, `src/renderer` Electron (electron-vite). Alias `@renderer` → `src/renderer/src`, `@shared` → `shared`.

## Rules
- Audio thread code (`Module::process`, scheduler, param drain, program swap): no allocation, locks, syscalls, exceptions, logging. Tests assert this.
- Adding a module = one `.cpp` in `engine/src/modules` + one line in `builtin.cpp`. No TypeScript changes.
- Styling: Tailwind v4 utility classes over the tokens in `src/renderer/src/css/theme.css`. No CSS Modules. Use the theme's colour names (`bg-background`, `text-muted-foreground`, `border-border`, `text-signal-audio`); never a literal colour or a `[var(--x)]` escape hatch.
- The palette lives once, in `theming/themes/*.ts`, and is injected as CSS at startup by `theming/theme-variables.ts`. `css/theme.css` holds only the `@theme` name mapping (plus two ground colours for the pre-paint frame) — never a palette value. `theming/theme-parity.test.ts` guards both. Grid colours must be `#rrggbb`; `hexToNumber` parses nothing else. A colour needed by something that cannot read CSS goes through `lib/css-color.ts`.
- A workspace can set `ui.theme`, override colours via `theme` dot-paths, and define whole themes under `themes` — all resolved in `theming/workspace-themes.ts` into the one list the theme store holds. There is no separate store for canvas colours.
- Descriptors are C-layout; never put std types in them.
- Signals are `pg::Sample` (vital::poly_float, lanes v0.L v0.R v1.L v1.R). Never add channel counts to ports.
- The renderer never touches the filesystem. It names a project by its slug; `src/main/workspace/path-guard.ts` is the only place that turns a name into a path, and every write is temp-file-then-rename.
- Settings (including keybindings, and which panel is in which dock slot) live in the workspace's `workspace.json`; `config/defaults.ts` is the one table of what exists and `config/config-schema.ts` turns it into both the runtime validator and the editor's autocomplete. Only the dock's geometry — column widths and split ratios, which are about the display — and the workspace pointer live under `userData`.
- A panel is a `WidgetDefinition`; adding one is a line in `config/registry-ids.ts`, a definition file, and a line in `register-widgets.ts`. Same shape for status bar items, control bars and minimap drawers. See docs/ui.md.
- `engine/vendor/vital` is vendored GPL code: never edit it (shims only), never use the names "Vital"/"Tytel" in ids, UI or binaries.

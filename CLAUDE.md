# CLAUDE.md

phasegrid2 is a generative, grid-based modular music platform (Bitwig Grid-like). AGPL-3.0.
Spec: docs/superpowers/specs/2026-09-07-phasegrid2-architecture-design.md. Engine rules: docs/engine.md.

## Commands
- `npm run dev` — build engine (incremental) and start Electron with HMR
- `npm run typecheck && npm run lint:fix` — REQUIRED after any TypeScript change
- `npm test` — vitest unit project
- `npm run engine:build` / `npm run engine:test` — CMake build and Catch2 tests; REQUIRED after any C++ change
- `npm run engine:render -- patch.json --seconds 2 --out out.wav` — headless render

## Layout
- `engine/` C++20 audio engine (separate process). `src/core` graph/scheduler, `src/modules` one file per module, `src/services` device/midi/telemetry/socket, `tests/` Catch2.
- `native/` N-API shared-memory reader (phase 5).
- `shared/` protocol schemas shared by main/preload/renderer.
- `src/main`, `src/preload`, `src/renderer` Electron (electron-vite). Alias `@renderer` → `src/renderer/src`, `@shared` → `shared`.

## Rules
- Audio thread code (`Module::process`, scheduler, param drain, program swap): no allocation, locks, syscalls, exceptions, logging. Tests assert this.
- Adding a module = one `.cpp` in `engine/src/modules` + one line in `builtin.cpp`. No TypeScript changes.
- Styling: CSS Modules + CSS custom properties only. No Tailwind. Use `--font-size-*` and `--space-*` tokens; no inline static px.
- Descriptors are C-layout; never put std types in them.
- Signals are `pg::Sample` (vital::poly_float, lanes v0.L v0.R v1.L v1.R). Never add channel counts to ports.
- `engine/vendor/vital` is vendored GPL code: never edit it (shims only), never use the names "Vital"/"Tytel" in ids, UI or binaries.

# Telemetry Implementation Plan (Phase 5)

**Goal:** Let the interface watch the running audio — meters and scopes — without an IPC hop per frame, by writing it into shared memory the renderer reads directly.

**Architecture:** The engine maps a POSIX shared memory segment named for its own process id and writes fixed-size slots into it from the audio thread. Each slot is a seqlock: the writer bumps a counter before and after, and a reader that sees an odd or changed counter retries, so neither side ever blocks the other. A small Node-API addon, loaded by the Electron preload, maps the same segment read-only and hands the renderer a copied typed array. Which module owns which slot is decided by `telemetry.subscribe` over the existing socket, never inferred from the segment.

**Tech Stack:** C++20, POSIX `shm_open`/`mmap`, Node-API via `node-addon-api`, CMake, Catch2, vitest.

**Spec:** `docs/superpowers/specs/2026-09-07-phasegrid2-architecture-design.md`, the shared-memory paragraph and phase 5 of the phase table. Risk 4 says the addon is the thing to verify first.

## Global Constraints

- 64-byte header: magic `PGTL`, layout version, slot count, slot bytes (8 KiB), sample rate, block size, heartbeat. Then `slotCount` slots of `{seq, kind, channels, frames, blockIndex, payload}`.
- Meter payload is peak, RMS and clip per channel. Scope payload is `float[channels][1024]`.
- The segment is `/pg-<pid>`, unlinked when the engine exits and by the supervisor before a restart.
- Writing a slot happens on the audio thread and must not allocate, lock, or syscall. Reading never blocks the writer.
- `shared/protocol/telemetry.ts` and `engine/src/services/Telemetry.hpp` describe one layout. A mismatch is a test failure, not a runtime surprise.
- Work on `main`, in this session, no subagents. `PG_WERROR=ON npm run engine:test`, `npm run typecheck`, `npm run lint`, `npm test` and `node scripts/check-trademark.mjs` green before every commit. Never commit a failing test. Mutation-check every test.

## Traps, recorded up front

1. **The addon may not load in an Electron preload.** Electron 41 and Node disagree about module format and ABI, and the preload is the most constrained place to load native code. The spec names a fallback: polling in the main process over IPC. Settle this in Task 1, before anything is built on top of it.
2. **A seqlock needs the right fences, or it silently returns torn data.** The writer publishes an odd counter, writes, then an even one; the reader reads the counter, the payload, and the counter again, and retries if they differ. Without acquire and release ordering the compiler or the processor may reorder the payload past the counter, and the failure looks like occasional garbage rather than a crash.
3. **A stale segment outlives a crashed engine.** `shm_open` on a name that already exists silently attaches to the old one, so a restarted engine can write into a segment a reader still holds from the previous life. Unlink on start as well as on exit.
4. **A reader must never trust the segment's contents.** It is written by another process that may have died mid-write. Validate the magic, the layout version and every length before indexing, and treat a slot index out of range as absent rather than as a fault.
5. **Scope payloads are large.** Four scopes at 1024 floats each, read at frame rate, is a few megabytes a second of copying. Read only subscribed slots, and only when their sequence counter has actually changed.

## Task list

1. **The addon spike.** A minimal Node-API module built by CMake that opens a named segment, maps it read-only, and returns a copied `Float32Array`. Prove it loads and reads in three places: plain Node, the Electron main process, and an Electron preload with context isolation on. If the preload fails, stop and take the main-process polling fallback before writing anything else. Wire it into `scripts/build-native.mjs` so `postinstall` builds it.
2. **The layout and the writer.** `engine/src/services/Telemetry.{hpp,cpp}`: the header, the slot, the seqlock write, `shm_open`, `mmap`, unlink on start and exit. Tests cover the seqlock against a concurrent reader and prove a torn read is detected rather than returned.
3. **The two modules.** `display.meter` and `display.scope`, both flagged `kModuleWritesTelemetry`, writing their slot from `process`. An `[rt]` test proves writing a slot allocates nothing.
4. **The protocol.** `telemetry.subscribe` and `telemetry.unsubscribe`, returning the module-to-slot map, and `hello` reporting a real segment rather than null. The supervisor passes `--shm` and unlinks a stale segment before a restart.
5. **The reader.** `shared/protocol/telemetry.ts` with the layout constants and a pure decoder tested against a fixture buffer, the addon behind `window.telemetry.open/read/close` in the preload, and `docs/telemetry.md`.

## Verification

- A Node script reads a live meter from `--tone` through the addon and reports a level that tracks the tone.
- vitest decodes a fixture buffer, including a deliberately torn one and one with a bad magic.
- The engine's own tests prove the seqlock under contention and that slot writes are allocation-free.
- No segment survives the engine exiting, and none survives a crash-restart.

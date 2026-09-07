# Protocol and Supervisor Implementation Plan (Phase 4)

> **For agentic workers:** implement task by task. Each task ends with a green test run and a commit.

**Goal:** Let a client drive the running engine over a socket, and let Electron own the engine process, so a crash restarts and reconnects without losing the patch.

**Architecture:** The engine gains a `--socket <path>` mode: it opens the audio device, listens on a Unix domain socket, and runs a message loop that parses newline-delimited JSON, dispatches commands against `Engine` and `GraphModel`, and pushes events back. Command dispatch is a pure function over a JSON string, so almost all of it is tested without a socket. On the Electron side, a supervisor spawns the engine, restarts it with backoff, and a socket client turns the same protocol into typed promises. Both sides share one zod-typed command table.

**Tech Stack:** C++20, nlohmann/json, POSIX sockets (no new C++ dependency), Catch2. TypeScript, zod, Electron, vitest.

**Spec:** `docs/superpowers/specs/2026-09-07-phasegrid2-architecture-design.md`, sections "Protocol and process topology" and phase 4 of the phase table. The spec wins on conflict.

## Global Constraints

- Envelope: `{id, cmd, args}` to the engine; `{id, ok:true, result}` or `{id, ok:false, error:{code,message}}` back; events are `{event, seq, data}`. Unknown keys are ignored on both sides.
- `hello` returns `protocolVersion`, `engineVersion`, `catalogHash`, `conventions`, `shm`, `capabilities`. A major version mismatch is refused. `shared/protocol/version.ts` already holds `PROTOCOL_VERSION` and `isCompatibleProtocol`.
- Everything the socket loop touches runs on the message thread. The audio thread is never blocked and never reads the socket.
- Error codes are the engine's existing ones (`E_SCHEMA`, `E_UNKNOWN_TYPE`, `E_FAN_IN`, `E_VOICES`, `E_QUEUE_FULL`, ...). Do not invent a parallel vocabulary.
- `PG_WERROR=ON npm run engine:test`, `npm run typecheck`, `npm run lint`, `npm test` and `node scripts/check-trademark.mjs` all green before every commit. Never commit a failing test.
- Work on `main`. No branches, no worktrees, no pull requests.
- Mutation-check every test: break the code it covers, confirm that test and only that test fails, restore.

## Traps, recorded up front

These are the things that will otherwise be found the hard way.

1. **Unix socket paths are capped near 104 bytes on macOS.** Electron's `userData` is under `~/Library/Application Support/phasegrid2`, which plus a filename is close to the limit and silently fails to bind. Build the path, measure it, and fall back to `os.tmpdir()` when it is too long. Test the measurement, not the happy path.
2. **Newline-delimited JSON does not arrive one line per chunk.** A socket read can split a message anywhere, or deliver three at once. Both readers need a buffer that accumulates until a newline and keeps the remainder. Test with a message deliberately split mid-token.
3. **The engine must exit when its client goes away.** If the socket closes and the engine keeps running, every crash-restart cycle leaks an orphan process that still holds the audio device. Treat end-of-stream as shutdown.
4. **Pending calls must be rejected when the connection drops.** Otherwise the interface waits forever on a promise that can never settle.
5. **`patch.batch` must not half-apply.** `GraphModel` has no transaction. Follow `loadPatchJson`: build a fresh model, apply every op to it, and only move it into place if all of them succeeded.
6. **`transport.position` is read at about 20 Hz but produced on the audio thread.** Publish it as an atomic snapshot the message loop samples. Do not reach into engine state from the timer.
7. **Restart storms.** Exponential backoff, and five failures inside sixty seconds becomes `engine.crashed` rather than an infinite loop.

## File map

| Path | Responsibility |
|---|---|
| `shared/protocol/envelope.ts` | request, response and event zod schemas |
| `shared/protocol/patch.ts` | `PatchOp`, the shared vocabulary for history, sync, batching and persistence |
| `shared/protocol/commands.ts` | the typed command table `{ [name]: { args, result } }` |
| `engine/src/services/Protocol.{hpp,cpp}` | dispatch one JSON string to one JSON string, no sockets |
| `engine/src/services/CommandServer.{hpp,cpp}` | Unix socket, framing, the message loop, event push |
| `engine/src/app/main.cpp` (modify) | `--socket <path>` mode |
| `src/main/engine/socket-client.ts` | NDJSON over `net.connect`, pending map, events |
| `src/main/engine/supervisor.ts` | spawn, restart with backoff, stdio to logs |
| `src/main/index.ts` (modify), `src/preload/index.ts` (modify) | `window.engine.call` / `onEvent` over IPC |
| `scripts/engine-cli.mjs` | dev client for manual verification |

---

### Task 1: The shared protocol vocabulary

**Files:** create `shared/protocol/{envelope,patch,commands}.ts` and their `.test.ts` siblings.

The envelope schemas mirror the spec exactly. `PatchOp` is a discriminated union of `moduleAdd`, `moduleRemove`, `edgeAdd`, `edgeRemove`, `paramSet`, `moduleMove` and `setVoiceCount`; `moduleMove` is marked user-interface only, because engine sync drops it.

`commands.ts` is a table mapping each command name to its args and result schema, typed so `call<C>(cmd, args)` infers the result. Cover the commands this phase implements: `hello`, `engine.ping`, `engine.shutdown`, `catalog.get`, `patch.load`, `patch.clear`, `patch.batch`, `module.add`, `module.remove`, `edge.add`, `edge.remove`, `param.set`, `patch.setVoiceCount`, `patch.setFeedbackMode`, `transport.play`, `transport.stop`, `transport.setTempo`, `transport.seek`, `device.list`, `device.select`. Leave `midi.*` and `telemetry.*` out; they belong to later phases and a stub in the table is a lie.

Reuse `catalog.ts`'s existing schemas for `catalog.get`'s result rather than restating them.

Tests: every command's args schema accepts a valid payload and rejects a wrong-typed one; the response schema rejects an envelope that is neither ok nor error; `PatchOp` round-trips through parse.

### Task 2: Engine-side command dispatch

**Files:** create `engine/src/services/Protocol.{hpp,cpp}`, `engine/tests/test_protocol.cpp`.

One entry point that takes a request as parsed JSON plus the engine and registry, and returns a response as JSON. No sockets, no threads, no globals. Every command in Task 1's table gets a handler.

This is where nearly all the behaviour lives and nearly all the tests go, because a pure function is cheap to test exhaustively. Cover, at minimum: `hello` reports the real protocol version and catalog hash; an unknown command returns an error rather than throwing; malformed arguments return `E_SCHEMA` and never abort, exactly as `loadPatchJson` now behaves; `patch.batch` with a bad op in the middle leaves the model completely unchanged; `param.set` on a missing module errors; and every error path returns the engine's own code.

`patch.batch` applies to a copy and commits once. A commit failure is reported and the previous program keeps playing.

### Task 3: The socket server and `--socket` mode

**Files:** create `engine/src/services/CommandServer.{hpp,cpp}`; modify `engine/src/app/main.cpp`.

The server binds a Unix domain socket at the given path, unlinks any stale file first, accepts a single client, and loops: read, split on newlines with a carry buffer, dispatch through Task 2, write the response. End of stream means shut down.

`--socket <path>` opens the audio device through `MiniaudioBackend`, wires `Engine::renderInterleaved` into the callback, then runs the loop. It emits `engine.ready` once the device is open, `engine.log` lines for anything it would otherwise print, `patch.revision` after a successful commit, and `transport.position` about twenty times a second from an atomic snapshot the audio callback publishes.

Tests: a real socket round trip for `hello` and one patch edit; a request deliberately split across two writes still parses; two requests in one write both get answers; closing the client ends the loop. Keep these tests fast and free of sleeps, and make sure they cannot hang the suite if the server misbehaves.

### Task 4: The socket client

**Files:** create `src/main/engine/socket-client.ts` and its test.

Connects, frames newline-delimited JSON with a carry buffer, keeps a pending map keyed by request id, resolves or rejects each call, and emits events to listeners. On close it rejects every pending call with a clear error. Calls made while disconnected fail immediately rather than queueing silently.

Tests run against a real Unix socket server created in the test, not a mock, because the framing bug this guards against only appears with real chunking. Include a split-message test and a reject-on-close test.

### Task 5: The supervisor

**Files:** create `src/main/engine/supervisor.ts` and its test.

Spawns the engine binary with `--socket`, forwards its standard output and error as `engine.log` events, and watches for exit. On an unexpected exit it restarts with exponential backoff and emits `engine.connected` carrying `restarted: true`, which is the signal the frontend reconciler will later use to resend the patch. Five failures within sixty seconds emits `engine.crashed` and stops trying.

Compute the socket path here, with the length guard from trap 1.

Tests inject a fake spawn so no real process is needed: a clean exit does not restart, an unexpected exit does, backoff grows, and the crash threshold stops the loop. Use fake timers so the tests are instant.

### Task 6: The preload bridge

**Files:** modify `src/main/index.ts`, `src/preload/index.ts`, `src/preload/index.d.ts`.

`ipcMain` handles `engine:call` by forwarding to the supervisor's client; engine events are pushed to the window. Preload exposes `window.engine.call` and `window.engine.onEvent`, typed from the shared table so the renderer gets inference. The window is created as it is today; nothing about the renderer changes yet.

### Task 7: The command-line client and docs

**Files:** create `scripts/engine-cli.mjs`; modify `docs/engine.md`, add `docs/protocol.md`.

A small development client that spawns the engine, connects, and either runs one command from the arguments or reads commands from standard input. This is the manual verification path the spec's phase table names: `hello`, `catalog.get`, then `module.add` and hear it.

Document the envelope, the command table, the error codes, and the seven traps above, so the next phase does not rediscover them.

## Verification

- `PG_WERROR=ON npm run engine:test` green, with the count risen by the new protocol and server tests.
- `npm run typecheck`, `npm run lint`, `npm test` and `node scripts/check-trademark.mjs` green.
- Manual: `node scripts/engine-cli.mjs hello` prints a version handshake; `catalog.get` lists every module; building the golden synth patch through `module.add` and `edge.add` produces sound.
- Manual: kill the engine process with signal nine and confirm it restarts, reconnects, and emits `engine.connected` with `restarted: true`.
- Confirm no orphan engine process survives closing the client, which is trap 3.

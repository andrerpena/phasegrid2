# The engine protocol

The engine is a separate process. A client drives it over a Unix domain socket, one JSON message per
line, in both directions. `shared/protocol/` is the single definition of that vocabulary: the engine's
handlers and the TypeScript client are both written against it, so a disagreement is a test failure
rather than a runtime surprise.

Run the engine with `--socket <path>`. It opens the audio device, binds the socket, and serves one
client. `scripts/engine-cli.mjs` is a development client; `node scripts/engine-cli.mjs --demo` builds a
polyphonic patch one command at a time and plays it.

## The envelope

A request is `{id, cmd, args}`. A reply is `{id, ok: true, result}` or
`{id, ok: false, error: {code, message}}`, always carrying the id it answers. An event is
`{event, seq, data}` and belongs to nobody's request. Unknown keys are ignored on both sides, so adding
a field is not a breaking change.

`hello` is the handshake and the only command that may be sent before compatibility is known. It reports
the protocol version, the engine version, the catalog hash, the signal conventions, the shared memory
region, and the capabilities this build actually has. A major version the engine cannot speak is refused
with `E_VERSION` rather than answered wrongly.

Errors use the engine's own codes, the same ones the graph compiler and patch loader return: `E_SCHEMA`,
`E_UNKNOWN_TYPE`, `E_NODE_NOT_FOUND`, `E_FAN_IN`, `E_VOICES`, `E_QUEUE_FULL`, plus `E_UNKNOWN_CMD` and
`E_VERSION`, which only the protocol layer can produce. There is no second vocabulary.

## Commands

Grouped by what they touch. `shared/protocol/commands.ts` is authoritative for the argument and result
shapes; this is the map, not the territory.

- **Session:** `hello`, `engine.ping`, `engine.shutdown`.
- **Catalog:** `catalog.get`, which returns every module descriptor including each port's signal role and
  the module's `face` (rows of tokens naming its blocks, or null; docs/adding-a-module.md).
- **Pictures:** `module.preview`, one cycle of a module's waveform at its current values, for the module's
  face to draw. Only modules whose descriptor has `previewsWave` answer; the rest return `E_UNSUPPORTED`.
  The picture is computed by the module from the same parameters the sound is, on the message thread.
- **Patch:** `patch.load`, `patch.clear`, `patch.batch`, `module.add`, `module.remove`, `edge.add`,
  `edge.remove`, `param.set`, `patch.setVoiceCount`, `patch.setFeedbackMode`.
- **Transport:** `transport.play`, `transport.stop`, `transport.setTempo`, `transport.seek`,
  `transport.setTimeSignature`.
- **Devices:** `device.list`, `device.select`.

MIDI and telemetry commands are absent on purpose. Neither subsystem exists yet, and a stub in a typed
table is something a client would build against and then discover was a lie.

Two things about editing a patch are worth knowing. Every edit, single or batched, applies to a copy of
the graph and is committed once, so a failing operation anywhere in a batch leaves the engine exactly as
it was: one user gesture is one atomic edit. And `param.set` reaches the audio thread through a lock-free
queue without recompiling, which is what lets a knob be dragged at frame rate; a batch containing only
parameter changes still recompiles, so a drag belongs in `param.set`, not in `patch.batch`.

## Events

`engine.ready` once the device is open, `engine.log` for anything the engine would otherwise print,
`engine.error`, `patch.revision` after every successful commit, and `transport.position` about twenty
times a second. Position is produced on the audio thread and published as an atomic snapshot the message
loop samples, so reading it never touches engine state or blocks audio.

## Traps

Each of these cost real time to find, and each has a test that fails without its guard.

1. **Unix socket paths are capped near 104 bytes on macOS**, and an over-long path does not fail loudly:
   it binds somewhere nobody can reach. The path is measured in bytes, not characters, because a
   non-ASCII user name costs more than one byte each, and falls back to the temporary directory when the
   application's data directory does not fit.
2. **A socket read has nothing to do with message boundaries.** It can split a message mid-token or
   deliver three at once. There is exactly one implementation of the framing rule, `LineBuffer` in
   `shared/protocol/envelope.ts`, and every reader uses it rather than keeping a private copy that drifts.
3. **The engine exits when its client goes away.** End of stream is the shutdown signal. Without it every
   crash-and-restart cycle would leak a process still holding the audio device.
4. **Every pending call is rejected when the connection drops.** A promise that can never settle is worse
   than an error, because the interface waits on it forever with nothing to show the user.
5. **A batch never half-applies**, as above.
6. **Transport position crosses threads as a snapshot**, never as a reach into engine state.
7. **Restarts back off exponentially**, and five failures inside sixty seconds becomes `engine.crashed`
   rather than an infinite loop.

## The supervisor

`src/main/engine/supervisor.ts` owns the engine process: it spawns it, forwards its output as
`engine.log`, restarts it when it dies unexpectedly, and emits `engine.connected` carrying `restarted`
so a client knows to resend its patch. It renumbers events as it forwards them, because the engine
numbers its own from one per connection and a restart would otherwise look like time running backwards.

The renderer never sees any of this. It calls `window.engine.call` and subscribes with
`window.engine.onEvent`, both typed from the same shared table. A failure crosses the process boundary as
data rather than as a thrown error, because Electron serializes an error by its message alone and the
code is the part callers branch on.

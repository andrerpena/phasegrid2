# Engine

C++20 process. One message thread (socket/commands, compiles), one audio thread (device callback).

## Signal type

The wire signal is `pg::Sample = vital::poly_float`: four float lanes `[voice0.L, voice0.R, voice1.L, voice1.R]`
(SSE2 on x86-64, NEON on arm64). Every continuous port carries `Sample[numFrames]`; stereo everywhere; mono sources write L = R.
Voices run in pairs: `Program.voicePairs = ceil(voiceCount / 2)`, unused voice lanes are masked at the output fold.
Helpers in `core/Signal.hpp` (`lanes::voice/left/right/mono/stereo/lane`). `kMaxBlockSize = 128`.

## Threads and RT rules

Audio-thread code = `Module::process`, `Scheduler::run`, `Engine::renderBlock`, param drain, program swap.
No `new`/`delete`/growing containers, no locks, no syscalls, no exceptions, no logging, no `std::function` construction.
Allocate in `Module::prepare` only. `[rt]` tests fail on any global allocation inside an `RtScope`.
`PG_RT_NONBLOCKING` (`[[clang::nonblocking]]`) marks audio functions as a trailing attribute paired with `noexcept`; on this toolchain it is documentation unless the `rtsan` preset is used; the `RtScope` tests enforce the rules in the test harness.

## Vendored Vital DSP

`engine/vendor/vital` (GPL-3.0-or-later, see NOTICE.md) provides the SIMD types, fast math, oscillators, filters,
effects, modulators and the wavetable authoring layer. JUCE is replaced by `engine/vendor/vital/shim`. Never edit vendored files;
never use the names "Vital"/"Tytel" in ids, UI or binaries. `npm run lint:trademark` enforces the naming rule over
`engine/src`, `shared` and `src`.

The JUCE shim (`engine/vendor/vital/shim/JuceHeader.h`) reaches **every** engine translation unit, via
`core/Conventions.hpp` → `common.h`, and it declares `String`, `MemoryOutputStream`, `Base64`, `ProjectInfo` and the
`JUCE_*` macros at **global** scope. Those names are therefore effectively taken engine-wide: do not introduce a
global `String` or `Base64` of your own, and expect an unqualified `String` in engine code to mean the shim's. This
is inherent to the vendoring decision (the vendored sources use those names unqualified); it is recorded here so a
collision later is not a surprise. The vendored include directories are marked `SYSTEM` so their warnings are not
attributed to our sources.

## Params

`ParamDesc` has min/max/default in display units and a curve. `ParamState` stores the normalized target and a 5 ms smoother.
Modulatable params get an implicit input port `param:<id>`; effective value = `denormalize(clamp(knobNorm + signal))`, lane-wise.
Modules read `ctx.param(i).at(frame)` as a `Sample`.

## Program and hot-swap

`GraphModel` → `compileGraph` → `Program` (Block buffers, event buffers, ops, feedback states) on the message thread.
`Engine::commit` publishes with one atomic exchange; the audio thread adopts it at the next block and retires the old one.
When the retire queue fills, `Engine` keeps a `deferred_` program and adopts it on a later block; `commit()` runs `collectGarbage()` at entry.
`InstanceTable` reuses a `ModuleInstance` when `(id, type)` is unchanged; a change of sample rate or voice count makes it create fresh instances (DSP state resets).
Feedback memory is reused by edge id. Param changes never compile: `Engine::setParam` enqueues `{serial, param, norm}`; the audio thread applies it by binary search.

**Model params are applied at instance creation only.** `InstanceTable::acquire` copies `NodeModel::params` into a
`ModuleInstance` when it creates one; a reused instance keeps the values it already has. After `prepare`, `ParamState`
belongs to the audio thread (the param drain writes it every block), so the message thread must never touch it — that is
why `acquire` does not "fix up" a reused instance. The consequence: anything that changes model params without going
through `Engine::setParam` — today only `loadPatchJson`, which writes straight into the `GraphModel` — leaves the model
ahead of the engine for every node whose `(id, type)` survived the compile. This is harmless now because `--render`
builds a fresh `Engine` per patch. Any future path that loads a patch into a live engine must diff against a
message-thread "last applied" snapshot and push each changed value through the param queue, never through the model
alone. A dropped `E_QUEUE_FULL` enqueue has the same effect until the caller retries.

## Feedback

Tarjan SCCs. Nodes in an SCC (or with a self loop) form a cluster run once per sample (`feedbackMode: sample`) or per block (`block`).
Back edges read from / write to a `FeedbackState`: an exact one-sample (or one-block) delay.

## Compilation constraints

- Max 2 voices (one pair) per program; `compileGraph` rejects `voiceCount > 2` with `E_VOICES`.
- Fan-in into one port is capped at `kMaxPortsPerModule` (32) → `E_FAN_IN`.

## Ops

`Sum{dst, argsStart, count}`, `Merge{dstEvt, argsStart, count}`, `FillParam{node, param, modBuf}`, `FeedbackRead{fb, dst}`,
`FeedbackWrite{fb, src}`, `ClearEvents{evt}`, `Process{node}`, `ClusterBegin{count}`, `ClusterEnd`.

## Unconnected ports

Unconnected continuous inputs reach modules as empty `SignalView`s (data = nullptr). Read through `readOr()` to get silence.
Event inputs are always valid buffers (empty when unconnected).

## Tests

`npm run engine:test` runs 55 Catch2 tests. `PG_WERROR=ON npm run engine:test` additionally builds with `-Werror`
(CI does this; it is off by default because `postinstall` builds the engine on end-user machines).

Headless render, using a patch built from builtin modules only:

```
./build/engine/phasegrid-engine --render engine/tests/golden/silence.json --seconds 2 --out out.wav
```

`engine/tests/golden/silence.json` is that patch — a bare `io.audioOut`, so it writes 2 s of silence until the
oscillator modules land. `engine/tests/golden/const_to_out.json` is a **test-only** fixture: it uses `test.const`,
which only `pg_tests` registers, so `--render` on it exits 1 with `E_UNKNOWN_TYPE`.

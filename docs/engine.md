# Engine

C++20 process. One message thread (socket/commands, compiles), one audio thread (device callback).

## Signal type

The wire signal is `pg::Sample = vital::poly_float`: four float lanes `[voice0.L, voice0.R, voice1.L, voice1.R]`
(SSE2 on x86-64, NEON on arm64). Every continuous port carries `Sample[numFrames]`; stereo everywhere; mono sources write L = R.
Voices run in pairs: `Program.voicePairs = ceil(voiceCount / 2)`, unused voice lanes are masked by the terminal module (see the scheduler contract below).
Helpers in `core/Signal.hpp` (`lanes::voice/left/right/mono/stereo/lane`). `kMaxBlockSize = 128`.

Every port declares a `SignalRole` -- `Any`, `Audio`, `Cv`, `Gate`, `Pitch`, `Phase`, `Note` -- which is a UI
coloring hint only: the compiler accepts any output into any input, and roles never appear in `process`. `Note`
is a role on an *event* port (a stream carrying pitch and velocity), not a `PortKind` of its own; an event port
carrying bare triggers stays `Gate`, so the two read differently in the editor. Roles cross the descriptor ABI
as `uint8_t`, so new ones are appended. `--catalog` emits the role of every port and
`src/renderer/src/css/tokens.css` has a `--color-signal-<role>` token for each.

## Threads and RT rules

Audio-thread code = `Module::process`, `Scheduler::run`, `Engine::renderBlock`, param drain, program swap.
No `new`/`delete`/growing containers, no locks, no syscalls, no exceptions, no logging, no `std::function` construction.
Allocate in `Module::prepare` only. `[rt]` tests fail on any global allocation inside an `RtScope`.
`PG_RT_NONBLOCKING` (`[[clang::nonblocking]]`) marks audio functions as a trailing attribute paired with `noexcept`; on this toolchain it is documentation unless the `rtsan` preset is used; the `RtScope` tests enforce the rules in the test harness.

## Voices and the scheduler contract

`Program.voicePairs = ceil(voiceCount / 2)`, up to `kMaxVoices` = 32 voices (16 pairs). `Scheduler::run`
executes the **whole op list once per pair**, in **ascending pair order**, inside one block, passing the pair
index as `ctx.voice` and that pair's active-lane mask as `ctx.voiceMask`. Buffers and event buffers are shared
by every pair, so a pair overwrites what the previous one left and only the last pair's values survive a block.

That has one consequence every module has to honour:

- **Per-block work runs on pair 0.** Work that is identical for every voice -- reading the block's note
  events, deriving a playhead from `transport.ppq` -- must happen when `ctx.voice == 0`, with the result
  reused for later pairs, or it happens `voicePairs` times. Ascending order is what makes "pair 0 first"
  meaningful. Per-*voice* state is indexed by the pair instead: `VoicedModule<State>` sizes its vector to
  `voicePairs` and `st(ctx)` picks `ctx.voice`.

A **terminal module masks its own contribution**: `io.audioOut` (and the test suite's `test.sink`) applies
`ctx.voiceMask` as it adds into the bus. That is the last point at which the pair the lanes belong to is
known -- by the time `Engine::renderBlock` folds the bus, every pair has added into it and no single mask
describes the sum, so the fold applies none. Masking there with pair 0's mask let the empty lane of an odd
count's last pair through as a phantom voice.

Parallelising pairs later would break both halves of the per-block rule -- the ordering and the shared
buffers -- so it would have to revisit this contract, not just the loop.

## Vendored Vital DSP

`engine/vendor/vital` (GPL-3.0-or-later, see NOTICE.md) provides the SIMD types, fast math, oscillators, filters,
effects, modulators and the wavetable authoring layer. JUCE is replaced by `engine/vendor/vital/shim`. Never edit vendored files;
never use the names "Vital"/"Tytel" in ids, UI or binaries. `npm run lint:trademark` enforces the naming rule over
`engine/src`, `shared` and `src`.

`engine/src/vital/` adapts that library to the Grid. `pg::vendor::WrappedModule` is a single `Module` implementation
that wraps any `vital::SynthModule`; a module type is a `pg::vendor::ModuleSpec` value (see
`engine/src/modules/vital/`), and `buildDescriptor` generates its `ModuleDescriptor` at registry time from the
vendored parameter table, so param ranges and units are the DSP's own. Six traps the vendored framework sets:

- Every `vital::Output` needs a non-null `owner` Processor: `ModulationSum::process` dereferences it to ask whether
  the signal is control rate. The adapter's own Outputs get the `AdapterSource` stub for that.
- A control's `string_lookup` may be shorter than its own min..max range, when the names depend on a second control
  (a filter's `style` is named differently per `model`). Generating labels from it would read off the end;
  `ControlOverride::suppressLabels` emits the control as a plain integer instead.
- The router runs `local_order_`, but only `global_order_` is topologically sorted by `plug()`, and the rebuild that
  copies one into the other never fires on the object that owns the graph — upstream processes per-voice *copies*,
  whose copy constructor does that rebuild. A module that plugs a processor before creating the controls feeding it
  (the envelope does) would therefore read its controls one block late, and read zero on the first block. Build every
  vendored module through `pg::vendor::makeModule<T>(...)`, which wraps it in `pg::vendor::Sorted<T>` and asks for the
  rebuild once, after `init()`.
- Some modules write only `buffer[0]` of a full-size output (`Envelope::processAudioRate` fills its value buffer per
  sample but sets the phase once, at the end; so do the LFO's phase and frequency readouts, the flanger's and phaser's
  sweep readouts and all six compressor meters). `OutputMap::firstFrameOnly` makes the adapter broadcast frame 0 across
  the block rather than copy samples the module never wrote. `Output::isControlRate()` does not catch these: it tests
  `buffer_size == 1`, and a control-rate *Processor* still allocates full-size Outputs.
- A `string_lookup` is indexed by the control's raw value, not by its offset from `min`. A control whose range starts
  above zero (the delay's `tempo` is 4..12, i.e. "4/1".."1/64") must have its labels read from that offset;
  `buildDescriptor` does. Check both ends against the table's real length.
- A few vendored modules hold `vital::Output`s by value (the chorus keeps one status output per delay pair), which
  deletes their copy constructor; those declare `clone()` as an assertion. `pg::vendor::Sorted<T>::clone()` returns
  null for such a type instead of failing to compile.

The JUCE shim (`engine/vendor/vital/shim/JuceHeader.h`) reaches **every** engine translation unit, via
`core/Conventions.hpp` → `common.h`, and it declares `String`, `MemoryOutputStream`, `Base64`, `ProjectInfo` and the
`JUCE_*` macros at **global** scope. Those names are therefore effectively taken engine-wide: do not introduce a
global `String` or `Base64` of your own, and expect an unqualified `String` in engine code to mean the shim's. This
is inherent to the vendoring decision (the vendored sources use those names unqualified); it is recorded here so a
collision later is not a surprise. The vendored include directories are marked `SYSTEM` so their warnings are not
attributed to our sources.

## Modules

Built-ins are registered in `engine/src/modules/builtin.cpp`, one line each. Own modules are a single `.cpp` under
`engine/src/modules`; vendored-backed ones a single `ModuleSpec` under `engine/src/modules/vital`. Today, twenty-one:

- own: `io.audioOut`, `note.toCv`, `note.toPoly`, `phase.clock`, `math.scaleOffset`, `mix.mixer`, `amp.vca`
- vendored-backed: `osc.wavetable`, `sampler.player`, `filter.multi`, `env.dahdsr`, `mod.lfo`, `mod.random`, and the
  eight effects `fx.reverb`, `fx.delay`, `fx.chorus`, `fx.flanger`, `fx.phaser`, `fx.distortion`, `fx.compressor`,
  `fx.eq`.

`phase.clock` follows `transport.ppq` while the transport is playing and free-runs off `transport.samplePos` at the
transport tempo while it is stopped, so a patch keeps moving with nothing rolling. Its swing moves the boundary inside
each *pair* of cycles (the second starts at `1 + swing` instead of `1`, and both are stretched back over a full 0..1
ramp), which degenerates to plain `frac(position)` at swing 0. Its phase output is `0 <= phase < 1`: a double a hair
under one rounds UP to exactly `1.0f` when narrowed, so the narrowing is clamped rather than trusted.

`note.toPoly` is the polyphonic sibling of `note.toCv`: its pitch, gate and velocity outputs carry a different
value in each voice lane. Its voice table is per *program*, not per pair, so it is not a `VoicedModule`: pair 0
runs the whole block's allocation once and records a change list, and every pair (0 included) then replays that
list for the two voices its lanes carry. The table has `2 * voicePairs` entries so every lane index is in range,
but allocation stops at `voiceCount` -- a note on the empty lane of an odd count's last pair would be masked away
at the terminal and go silently missing. A note takes the lowest free voice, or steals the one that has been
sounding longest, and a steal drops that voice's gate for exactly one frame so a downstream envelope retriggers.
A note off matches on the note number, so a note off for a note that was already stolen releases nobody.

`amp.vca` clamps `gain knob + gain input` at zero before applying its curve -- a control that swings negative closes
the amplifier instead of inverting the signal, and squaring an unclamped negative sum would fold it back open.

There is no built-in source of *events* yet (`io.midiIn` lands with phase 4), so `note.toCv` and `note.toPoly` can
only be driven from a test module today. A patch that needs a constant uses `math.scaleOffset` with nothing plugged in: `out = 0 * scale +
offset`.

The effects all share one shape, built by `effectSpec` in `engine/src/modules/vital/Effect.hpp`: the audio goes in
through `processWithInput` rather than a plugged input, so the `in` port carries vendored input index -1. None of them
creates the `<name>_on` control the host synth uses to bypass it -- that switch lives in the host -- so there is no
`on` param to hide: on the grid an effect is bypassed by unplugging it. Their tempo-synced `sync`/`tempo` controls ARE
in the vendored parameter table (`createTempoSyncSwitch` creates the `cr::Value` behind a name the table describes), so
they are generated like any other param.

Testing an effect with a one-sample impulse in block 0 measures nothing: every one of them ramps its wet/dry mix, and
the filters ramp their coefficients, from zero across the first block they see, so the impulse is multiplied by ~0.
Drive them with a steady source (`osc.wavetable`, or a DC `test.const`) and let them settle first.

`pg::vendor::WavetableBank` (`engine/src/vital/WavetableBank.*`) renders the built-in wavetables and reads the
vendored authoring format from JSON. Message thread only: a render resizes the table's frame storage and the
vendored `setNumFrames` spins until the audio thread has released the old frames. The audio thread never touches a
table except through the `markUsed()`/`markUnused()` handshake the vendored oscillator performs for itself, which is
what lets a table be swapped under a running oscillator without a lock of ours.

`pg::vendor::SampleBank` (`engine/src/vital/SampleBank.*`) is the same story for audio files: `loadWav` decodes
anything miniaudio reads into the vendored `Sample` a sampler plays, mono or stereo, at the file's own rate.
Message thread only, for the same two reasons -- it allocates the whole band-limited pyramid, and the vendored
`loadSample` then SPINS until the audio thread has released the previous data. With nothing loaded a sampler plays
the vendored default, a second of white noise, so the module is audible the moment it is placed.

A vendored module whose controls are hard-coded rather than prefixed can still take a `ModuleSpec::prefix`: the
sample player names its controls `sample_*` outright, and declaring `prefix = "sample"` is what turns them into the
grid param ids `level`, `loop`, `pan` rather than `sample_level` and friends.

## Params

`ParamDesc` has min/max/default in display units and a curve. `ParamState` stores the normalized target and a 5 ms smoother.
Modulatable params get an implicit input port `param:<id>`; effective value = `denormalize(clamp(knobNorm + signal))`, lane-wise.
Modules read `ctx.param(i).at(frame)` as a `Sample`. `ParamView::knob` carries the *unmodulated* value for the block,
so a module that has to hand the knob and the modulation to a downstream engine separately recovers the modulation
as `at(i) - knob`.

`kParamStructural` marks a param that cannot be applied to a live instance (an LFO shape, a wavetable choice):
`InstanceTable::acquire` builds a fresh instance instead of reusing the old one. A structural param may never be
`kParamModulatable` -- `Registry::add` rejects that -- because it is read once, on the message thread, by
`Module::configure(const ParamValues&, const NodeData&)`, which runs before `prepare()`.

## Node data

`NodeModel::data` is an arbitrary JSON **object** per node: structured state the module owns and no param can
express -- a clip's notes, a curve's breakpoints. It lives in the patch document, so it undoes and saves with the
rest of it, and it reaches the module as `configure`'s second argument, on the message thread, before `prepare`.
Nothing between the patch file and the module looks inside it: `GraphModel::addNode` and `setNodeData` are the
only gate, and they check only that it is an object (`E_SCHEMA` otherwise -- `loadPatchJson` returns that rather
than throwing, like every other bad shape), so validating the contents is the module's own job. `savePatchJson` writes it back out, omitting an empty one.

Node data is **structural**, exactly like a `kParamStructural` param and for the same reason: `configure` is the
only place it is ever read, so the only way to apply a change is to build the instance again --
`InstanceTable::acquire` compares the blob and rebuilds when it differs. That is a heavy hammer for something
edited as often as a clip's notes, and it is affordable only because such a module derives its position from
`transport.ppq` every block, so a rebuilt instance resumes where the old one was rather than restarting. Unlike
`params`, `data` is genuinely diffed here, so the model cannot get ahead of the engine the way param values can.
If editing ever proves too slow, the upgrade is the pattern the program swap already uses: build the new list on
the message thread, swap an atomic pointer, retire the old one.

## Program and hot-swap

`GraphModel` → `compileGraph` → `Program` (Block buffers, event buffers, ops, feedback states) on the message thread.
`Engine::commit` publishes with one atomic exchange; the audio thread adopts it at the next block and retires the old one.
When the retire queue fills, `Engine` keeps a `deferred_` program and adopts it on a later block; `commit()` runs `collectGarbage()` at entry.
`InstanceTable` reuses a `ModuleInstance` when `(id, type)`, every `kParamStructural` param value and `NodeModel::data` are unchanged;
a change of sample rate or voice count makes it create fresh instances (DSP state resets).
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
A `FeedbackState` holds **one delay slot per voice pair** (`z[pair]`), because the pairs share the program's
signal buffers but must not share memory that crosses from one pair's run to the next -- with a single slot,
pair 0's delayed sample lands in pair 1's loop. `InstanceTable::acquireFeedback` keeps the state alive across
compiles, keyed by edge id, and builds a *fresh* one when the voice pair count changes rather than resizing
one the audio thread may still be reading through an older program.

## Compilation constraints

- Max `kMaxVoices` = 32 voices (16 pairs) per program; `compileGraph` rejects more with `E_VOICES`. `GraphModel` itself accepts 1..64.
- Fan-in into one port is capped at `kMaxPortsPerModule` (32) → `E_FAN_IN`.

## Ops

`Sum{dst, argsStart, count}`, `Merge{dstEvt, argsStart, count}`, `FillParam{node, param, modBuf}`, `FeedbackRead{fb, dst}`,
`FeedbackWrite{fb, src}`, `ClearEvents{evt}`, `Process{node}`, `ClusterBegin{count}`, `ClusterEnd`.

## Unconnected ports

Unconnected continuous inputs reach modules as empty `SignalView`s (data = nullptr). Read through `readOr()` to get silence.
Event inputs are always valid buffers (empty when unconnected).

## Catalog

`phasegrid-engine --catalog` prints every registered module's ports, params, ranges, units and enum labels as JSON,
plus the engine-wide `conventions` a patch is written against. This is the renderer's *only* description of what a
module is: adding a module changes the JSON, not any TypeScript. `shared/protocol/catalog.ts` holds the zod schemas
for that document, and `engine/tests/golden/catalog.json` is a committed copy that `shared/protocol/catalog.test.ts`
parses (so the unit tests do not need a built engine) and `engine/tests/test_catalog.cpp` compares against a freshly
generated one (so the copy cannot go stale). Regenerate it with:

```
./build/engine/phasegrid-engine --catalog > engine/tests/golden/catalog.json
```

Modules are sorted by id and params keep their descriptor order, so the document is byte-stable for a given registry.
`catalogHash` is a 64-bit FNV-1a of the serialized module list, 16 hex chars, meant as the renderer's cache key.
The registry's input list is the declared ports followed by one implicit `param:<id>` port per modulatable param, in
the order the compiler assigns buffers; each port carries `implicit` and, when implicit, the `param` it feeds, so the
editor can draw it on the knob instead of in the port list. Every port carries its `role`, and every param its
`unit`, `curve`, `uiWidget`, `enumLabels` and the six `flags`.

The catalog is the one place the vendored DSP's own parameter table reaches strings the user interface displays, and
`scripts/check-trademark.mjs` reads sources rather than generated documents — so `test_catalog.cpp` scans the
generated JSON for the vendored names itself.

## Tests

`npm run engine:test` runs 137 Catch2 tests. `PG_WERROR=ON npm run engine:test` additionally builds with `-Werror`
(CI does this; it is off by default because `postinstall` builds the engine on end-user machines).

Headless render, using a patch built from builtin modules only:

```
./build/engine/phasegrid-engine --render engine/tests/golden/synth_voice.json --seconds 1 --out out.wav
```

`engine/tests/golden/synth_voice.json` is one whole synth voice: gate and pitch (constants from `math.scaleOffset`
nodes with nothing plugged in) into `osc.wavetable` (saw), into `filter.multi` (12 dB low pass at MIDI 83), into
`amp.vca` whose gain is `env.dahdsr` on the same gate, into `io.audioOut`. `engine/tests/test_golden_synth.cpp`
renders it and asserts on the signal rather than the file size: it is audible (RMS), it is a *note* (near-silent
through the 62 ms attack, decayed to the sustain level by 450 ms and flat from there), it is *pitched* (the strongest
partial of the settled note is within 15 Hz of 523.25 Hz, the pitch the patch asks for), it is *filtered* (a thousand
times more energy below 1 kHz than above 8 kHz, and opening the cutoff on the same running engine raises the high band
a hundredfold — which a source that simply had no harmonics could not do), and both channels carry it.

The voice has no `note.toCv` in it because there is no built-in event source yet; that arrives with `notes.clip` and a
polyphonic golden render in the next phase. `engine/tests/golden/silence.json` is a bare `io.audioOut`, so it writes
silence. `engine/tests/golden/const_to_out.json` is a **test-only** fixture: it uses `test.const`, which only
`pg_tests` registers, so `--render` on it exits 1 with `E_UNKNOWN_TYPE` — which is why the synth voice deliberately
uses no test module.

# Engine

C++20 process. One message thread (socket/commands, compiles), one audio thread (device callback).

## Signal type

The wire signal is `pg::Sample = vital::poly_float`: four float lanes `[voice0.L, voice0.R, voice1.L, voice1.R]`
(SSE2 on x86-64, NEON on arm64). Every continuous port carries `Sample[numFrames]`; stereo everywhere; mono sources write L = R.
Voices run in pairs, two per `Sample`, inside an *instrument* (see below); a global signal lives in voice 0's lanes with voice 1's mirroring it, and an exit gains the lanes it folds (`VoiceGain`: the lane mask, and the ramp of a voice on its way out).
Helpers in `core/Signal.hpp` (`lanes::voice/left/right/mono/stereo/lane`). `kMaxBlockSize = 128`.

Every port declares a `SignalRole` -- `Any`, `Audio`, `Cv`, `Gate`, `Pitch`, `Phase`, `Note` -- which is a UI
coloring hint only: the compiler accepts any output into any input, and roles never appear in `process`. `Note`
is a role on an *event* port (a stream carrying pitch and velocity), not a `PortKind` of its own; an event port
carrying bare triggers stays `Gate`, so the two read differently in the editor. Roles cross the descriptor ABI
as `uint8_t`, so new ones are appended. `--catalog` emits the role of every port and
`src/renderer/src/css/theme.css` has a `--signal-<role>` custom property for each, exposed to
Tailwind as `--color-signal-<role>` and mirrored in `theming/themes/*.ts` for the canvas — see
[docs/ui.md](ui.md).

## Threads and RT rules

Audio-thread code = `Module::process`, `Scheduler::run`, `Engine::renderBlock`, param drain, program swap.
No `new`/`delete`/growing containers, no locks, no syscalls, no exceptions, no logging, no `std::function` construction.
Allocate in `Module::prepare` only. `[rt]` tests fail on any global allocation inside an `RtScope`.
`PG_RT_NONBLOCKING` (`[[clang::nonblocking]]`) marks audio functions as a trailing attribute paired with `noexcept`; on this toolchain it is documentation unless the `rtsan` preset is used; the `RtScope` tests enforce the rules in the test harness.

## Instruments, voices and the scheduler contract

Polyphony is not a property of the patch. An **instrument** is the region of a patch between a *voice
entry* -- `note.toPoly`, which turns a note stream into one pitch, gate and velocity per voice and owns the
pool those voices come from (its `voices` param, default 16, at most `kMaxVoices` = 32) -- and its *voice
exits*, the folds that add the voices back into one signal: `voices.sum`, or `io.audioOut` itself. The
compiler works out membership from the cables: every node a continuous signal path reaches from the
entry's outputs without crossing an exit is **per-voice** and belongs to that instrument; the exit belongs
too, but what leaves it is **global**. Everything reached from no entry is global. A node two entries reach
is `E_INSTRUMENT_MIX` (sum one first); a feedback loop that straddles an instrument's edge is
`E_FEEDBACK_DOMAIN`. Event ports are always global: a note stream is the same for every voice. Two
converters are two instruments with independent pools; an instrument's summed output may feed another
instrument as a global signal, and the compiler orders them so it does. `kModuleVoiceEntry` and
`kModuleVoiceExit` mark the two ends in a descriptor; a module cannot be both.

The program is a list of **segments**. A global segment runs its ops once, with `ctx.voice` 0,
`firstPass` and `lastPass` both true, `ctx.voiceMask` voice 0's lanes and `ctx.activity` null. An
instrument's ops are one contiguous segment (its pairs share the program's buffers, so a pass must see the
whole instrument's work for its own pair): the scheduler first runs the entry's **`Module::allocate`**
once, which reads the block's note events and marks the instrument's `VoiceActivity` (`core/Voices.hpp`)
-- a note on makes a voice *held*, a note off lets it *release* -- then runs the ops once per **live
pair**, in ascending order, with `ctx.voice` the pair, the mask the lanes of its voices that are not free,
`firstPass` on the first live pair and `lastPass` on the last, and `ctx.activity` the pool. A pair with
no held or releasing voice is not run at all, which is why a pool of sixteen costs nothing while nothing
plays.

**When a released voice ends** is the reference instrument's rule, not a measurement (docs/adrs/0002).
After its note off a voice lives only while something in the instrument *holds* it, and each holder says
so per pass, per block, through `VoiceActivity::hold(voice)`. An envelope holds its voice until its
release stage is over (`env.adsr` reads its envelope's own stage; its `lifetime` toggle, on by
default, takes it out of the decision). The same pool answers the other direction too: an `env.adsr`
with nothing plugged into its Gate follows the note its voice is holding, so the first patch anyone
builds makes sound rather than silence -- block-accurate, where a cable from the converter's Gate is
exact (docs/adrs/0008). An exit -- `io.audioOut`, `voices.sum` -- holds a voice while
what it hears from it is above `kVoiceSilence`, but only with its own `lifetime` toggle on, which is off
by default. So a voice with an envelope rings out; a voice with none ends with its note -- a bare
oscillator stops rather than droning, and a run of single notes into it plays one voice instead of
filling the pool -- and a patch that wants a drone held until it is silent asks the exit for it.

**How a voice ends** (docs/adrs/0003). After the passes, `settle()` starts the outgoing ramp for every
releasing voice nobody held that block: the voice is not cut off but faded over `kVoiceFadeSeconds`,
because a wave stopped mid-cycle is a step and a step is a click. The exits apply the ramp and the lane
mask together through `VoiceGain`, and the voice is free when the ramp has played out. The ramp is
committed once it starts -- an exit stops hearing a voice *because* it is fading, and a claim then would
restart it -- so only a new note on that voice cancels it. Inside an instrument an oscillator also holds
a lane whose voice is free at the start of its cycle, so a voice taken back inside a pair that never went
quiet begins where a fresh one would.

**Allocation** takes a free voice first, then the longest-releasing, then the longest-held, with the
one-frame gate dip on a steal so a downstream envelope retriggers.

**The output** (`io.audioOut`, docs/adrs/0006) clips each pair's gained sum the way the reference
instrument's Audio Out does -- `clip` Off/Hard/Soft at `clipLevel` 0/+6/+12/+24 dB, Hard at +6 by
default -- before it reaches the bus, and publishes a `Meter` of what it sent, clip light included.
`Engine::renderBlock`'s fold then clamps to ±1 after the master gain and counts what it clamped
(`deviceClips`, in `engine.stats` and `patch.render`): nothing above full scale reaches the driver, and
a patch that is too loud is a number. An exit asked to affect voice lifetime holds a voice while its
peak is above `silence` (−96 dB) or was within `hold` (50 ms) of being so; both are its params.

**Denormals.** `Engine::renderInterleaved` puts the calling thread into flush-to-zero before anything else
(`rt/Denormals.hpp`, docs/adrs/0007). A denormal costs about a hundred cycles on x86-64 and turns up
wherever audio decays towards silence rather than stopping -- a reverb tail, a delay's feedback, an
envelope's release -- so it is heard as a crackle at the quietest moment rather than as a wrong number.
`renderBlock` is deliberately left alone, so a test calling it directly keeps plain IEEE arithmetic.

**The clock.** `Engine::renderInterleaved` is the device's entry point and the offline renderer's alike:
it takes a `Transport&`, cuts the callback into engine blocks, and calls `advance()` once per block, so a
512-frame callback is eight blocks of advancing time and never one block's time played eight times.
Every time-driven module derives its position from `ctx.transport->ppq` (playing) or `samplePos`
(stopped) plus the frame index, so the clock is the one thing that must be right for all of them at once.
`renderBlock` counts any block whose `samplePos` does not follow the previous one; the command loop
reports the first on stderr, `engine.stats` exposes the count, and the device period the platform
actually granted is in `hello` and `engine.ready`. A test renders one patch at five periods and requires
identical samples (docs/adrs/0005). `audio.capture.start`/`stop` records exactly what the device is
handed, so what a scenario measures can be the live output rather than a render of the same patch.

Two rules follow for a module:

- **Per-block work runs on the first pass.** Work that is the same for every voice -- reading the block's
  note events, deriving a playhead from `transport.ppq` -- happens when `ctx.firstPass`, and a fold that
  sums the voices (the display modules, `voices.sum`, `io.audioOut`) clears then and publishes on
  `ctx.lastPass`. Per-*voice* state is indexed by the pair: `VoicedModule<State>` sizes its vector to the
  node's `PrepareInfo.voiceCount`, which is the instrument's voices for a per-voice node and 1 for a global
  one, so a global LFO holds one state and a vendored oscillator only multiplies inside an instrument
  (`InstanceTable::acquire` rebuilds a node whose count moved and reuses the rest).
- **An exit gains its own contribution** with a `VoiceGain` built from `ctx` as it adds, never with the
  raw `ctx.voiceMask`. That is the last point at which the pair the lanes belong to is known -- by the
  time `Engine::renderBlock` folds the bus every pair has added into it and no single mask describes the
  sum -- and it is where the outgoing ramp has to go for the same reason. A global signal arrives with
  voice 0's mask, so its mirrored half is dropped and it reaches the output once.

`Module::reset(uint32_t voicePair)` is called by the scheduler on every module of an instrument when a
pair that was dead comes back to life, before the pair runs, so a new note starts from clean DSP state
rather than from what the last note left in a filter or a delay line. A stolen voice inside a live pair is
not reset: it retriggers through the gate dip, as a downstream envelope expects. `VoicedModule` clears its
state and the vendored adapter hard-resets the vendored module; the entry's own reset is a no-op because
the pool's memory is the activity's. Feedback memory (`FeedbackState::z`) is one slot per pair of the
loop's domain.

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
vendored parameter table, so param ranges and units are the DSP's own. Seven traps the vendored framework sets:

- A vendored `SynthModule` holds the DSP state of exactly ONE `poly_float` -- one voice pair. The vendored
  library handles polyphony by processing per-voice *copies* of its processors; we run the op list once per
  pair through one `Module`, so `WrappedModule` builds one vendored module, one set of adapter Outputs and
  one modulation scratch PER PAIR and `process` picks `ctx.voice`'s own. Sharing one between pairs is silent
  and total: pair 1's gate and pitch land in pair 0's oscillator and filter, and a chord collapses onto
  whichever pair went last. Building rather than cloning is deliberate -- `clone()` is unavailable on the
  vendored modules that hold `Output`s by value.

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
`engine/src/modules`; vendored-backed ones a single `ModuleSpec` under `engine/src/modules/vital`. Today, thirty-six:

- own: `io.audioOut`, `note.toCv`, `note.toPoly`, `notes.clip`, `notes.pattern`, `phase.clock`, `math.scaleOffset`,
  `mix.mixer`, `amp.vca`, `osc.sawtooth`, `osc.pulse`, `osc.sine`, `mod.lfo`, `display.meter`, `display.scope`,
  `display.value`, `display.piano`, `voices.sum`, `env.adsr`, and the four note effects `notefx.chord`, `notefx.quantize`, `notefx.arp`, `notefx.humanize`
- vendored-backed: `osc.wavetable`, `sampler.player`, `filter.multi`, `mod.random`, and the
  eight audio effects `fx.reverb`, `fx.delay`, `fx.chorus`, `fx.flanger`, `fx.phaser`, `fx.distortion`,
  `fx.compressor`, `fx.eq`.

A descriptor's `category` is the heading a catalogue shows the module under, written as a person reads it --
"Oscillators", "Audio FX", "Note FX" -- so an interface shows it as it is and adds nothing. Ids stay slugs.

### Note effects

A note effect is a module with a note stream in and a different one out: `engine/src/modules/NoteFx.hpp` is
what they share, and each of the four is one file on top of it. Two rules shape all of them:

- **An off releases what the on emitted.** The converters downstream (`note.toCv`, `note.toPoly`) match a note
  off to its note on by pitch, so an effect that changes a pitch or turns one note into several remembers, per
  incoming note, exactly the pitches it emitted (`HeldTable`) and releases those when the off arrives. The chord
  is fixed at the note on; changing the chord type or the project's key under a held note still releases what is
  actually sounding, and a tone that clamps onto another is dropped rather than doubled.
- **Once per block, on pair 0.** The note stream is the same for every voice, and an event buffer is cleared
  and refilled once per pair, so the block's outgoing events are worked out once and pushed again for every
  pair -- the shape `notes.clip` and `notes.pattern` follow.

`notefx.quantize` reads the project's key and scale from the transport snapshot (`scaleRoot`, `scaleMask`), which
the renderer pushes with `transport.setScale` beside the tempo and the meter; the engine keeps a twelve-bit mask
and never learns a scale's name. `notefx.arp` derives its step clock from the transport the way `phase.clock`
does, so it lines up with the grid, follows a seek, and free-runs at the project tempo while stopped.
`notefx.humanize` delays -- never advances -- each note by a random amount and its off by the same amount, keeping
notes in engine time (`samplePos`) in a fixed sorted queue; its random source is a seeded xorshift, so a part
plays the same way on every pass.

### Modulation, and the LFO built for it

A modulatable param's implicit `param:<id>` input adds its signal to the knob **in normalized units**
(see Params below): a signal of 0.25 moves any knob a quarter of its range, whatever its unit or curve.
`mod.lfo` (`engine/src/modules/ModLfo.cpp`) is shaped around that rule. Its output is bipolar,
`-depth..depth` around zero, so the knob it feeds stays the centre of the movement rather than its
floor; a unipolar LFO would push every knob upward and the first patch anyone built would subtract a
half. Rate is in hertz on a log knob across four decades; Shape is one knob that morphs sine, triangle,
saw, square in thirds, crossfading between neighbours, because a knob is modulatable, drawable on the
face and reachable without an inspector, none of which a drop-down is. A rising edge on `reset` restarts
the cycle. Every cycle starts at the bottom like the oscillators' (the square starts high, like
`osc.pulse`), so a reset gives a rising edge whichever shape is dialled. It is not band-limited: at LFO
rates there is nothing to alias. It previews (`kModulePreviewsWave`), so its face shows the wave at the
current Shape and Depth. The vendored LFO it replaced was unipolar and its frequency knob was a power of
two labelled seconds; nothing else used its line source, which stays vendored for drawn wavetables.

### Oscillators: one core, many shapes

`engine/src/modules/osc/Oscillator.hpp` holds everything an oscillator does that is not about which wave it plays:
pitch to frequency, the master phase, an external `phase` input in place of it, the `reset` gate, hard sync, the
band-limiting, the four lanes, and `preview`. A module supplies only a **shape**, which is a value at a phase plus a
list of where that value steps:

```cpp
float at(double phase) const;          // -1..1 across one cycle
uint32_t jumpCount() const;
ShapeJump jump(uint32_t i) const;      // { phase, delta } -- delta is the value after minus before
```

`osc.sawtooth` is `2p - 1` with one step of -2 at phase 0; `osc.pulse` is high below its width with +2 at 0 and -2 at
the width. Each module file is then about forty lines. The shape is built afresh per sample by a callable the module
passes in, so a parameter that shapes the wave (a pulse width, a skew) is modulatable with nothing else changing; it is
taken by value, so there is no allocation and nothing virtual on the audio thread.

**Two ways to be band-limited, one interface.** A wave that *breaks* declares its steps, and the core spreads each
one over four samples with the integral of a cubic B-spline: aliases about 40 dB down against 12 dB naive, measured at a
2 kHz fundamental in `test_osc_sawtooth.cpp` and `test_osc_pulse.cpp`. A wave that only *bends* declares no steps and
is expected to be smooth enough on its own: `osc.sine` folds through `sin` itself, which has no corners, and measures
87 dB at A4 fully folded. An arbitrary wave -- one drawn, one written as an expression, one imported -- can declare
nothing, and is read instead from a table band-limited per octave when it was built. Sync belongs to none of these,
because it is the oscillator that throws the wave back to phase zero mid-cycle; the core computes that step itself as
`at(0) - at(phase it had reached)`, which is as true of a table as of a formula.

A third way was built and removed, and is worth knowing about: a shape may average itself across the phase interval
each sample covers, exactly, as the difference of its antiderivative over the interval. It was worth ten decibels when
the sine's folding curve was a triangle and three to five, in the corner that is past saving anyway, once the curve was
`sin`. It went because no test could tell it was there; commit history has it if a bending shape ever needs it.

That is the seam for wavetables the user generates or draws. The pieces are already vendored: `LineGenerator`
(`getValueAtPhase`, `stateToJson`/`jsonToState`) for a breakpoint curve, `vital::Wavetable`
and `WavetableBank` for band-limited tables, and `NodeModel::data` to carry either through the patch document with undo
and save for free.

`phase.clock` follows `transport.ppq` while the transport is playing and free-runs off `transport.samplePos` at the
transport tempo while it is stopped, so a patch keeps moving with nothing rolling. Its swing moves the boundary inside
each *pair* of cycles (the second starts at `1 + swing` instead of `1`, and both are stretched back over a full 0..1
ramp), which degenerates to plain `frac(position)` at swing 0. Its phase output is `0 <= phase < 1`: a double a hair
under one rounds UP to exactly `1.0f` when narrowed, so the narrowing is clamped rather than trusted.

`note.toPoly` is the polyphonic sibling of `note.toCv` and the entry of an instrument: its pitch, gate and
velocity outputs carry a different value in each voice lane, and its `voices` param sizes the pool. Its voice
table is per *instrument*, not per pair, so it is not a `VoicedModule`: `allocate` runs once per block ahead
of the passes and records a change list against the instrument's `VoiceActivity`, and every pass replays that
list for the two voices its lanes carry. The table has `2 * pairs` entries so every lane index is in range,
but allocation stops at `voices` -- a note on the empty lane of an odd pool's last pair would be masked away
at the exit and go silently missing. A note takes a free voice first, then the voice that has been releasing
longest, then the one held longest, and a steal drops that voice's gate for exactly one frame so a downstream
envelope retriggers. A note off matches on the note number, so a note off for a note that was already stolen
releases nobody. `voices.sum` is the matching exit short of the output: it adds every live voice into one
global stereo signal on its last pass, so an effect after it runs once rather than once per voice.

`notes.clip` is the grid's own note source: a list of notes in musical time, played against the transport
and emitted as a note stream, with the playhead out as a phase. The notes live in the node's `data` as
`"notes"`, an array of `{start, length, pitch, velocity}` objects -- start and length in beats from the
clip's start, pitch a MIDI note number, velocity 0..1. `configure` validates the whole array and a clip with
anything malformed in it plays NOTHING, rather than throwing on the message thread or half-loading a list
whose JSON has a typo in it.

Its playhead is DERIVED from the transport every block rather than accumulated, which is what makes the
notes affordable as structural node data (see below): a rebuilt instance lands where the old one was.
Playing, it follows `transport.ppq`; stopped, it free-runs off `transport.samplePos` at the transport
tempo, the way `phase.clock` does, which is also what makes it audible under `--render`. An unconnected
`play` input runs the clip, so it is not silently stopped the moment it is placed.

Every frame re-derives the set of notes the playhead is inside and emits the difference against what is
sounding. A transport jump, a loop wrap, the play gate falling, an edit to the notes and a note simply
ending are then one code path, and none of them can leave a note on without its note off, because the note
off IS how a note leaves the set. An edit rebuilds the instance and the new one `adopt`s the held set: a
held note the new clip still has (same start, end and pitch) is rebound to it; one it no longer has is kept
as an orphan nothing covers, so the next frame releases it. A loop wrap releases everything first, so a note that fills the whole clip retriggers rather than
hanging. That costs O(frames x notes) per block, which is why a clip is capped at 512 notes. Events are
worked out once on pair 0 and replayed for every pair, per the scheduler contract; a note off carries the
note number its note ON used, so moving `transpose` under a held note still releases the right one.

`amp.vca` clamps `gain knob + gain input` at zero before applying its curve -- a control that swings negative closes
the amplifier instead of inverting the signal, and squaring an unclamped negative sum would fold it back open.

`notes.clip` is the only built-in source of *events* (`io.midiIn` lands with phase 4), so a patch that wants
`note.toCv` or `note.toPoly` driven by anything else needs a test module. A patch that needs a constant uses
`math.scaleOffset` with nothing plugged in: `out = 0 * scale + offset`.

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

`ParamDesc` has min/max/default in display units and a curve -- `Linear`, `Log`, `Exp` or `Quartic` --
and the curve is the taper between a knob's turn and the number, not a display detail: a param crosses
the protocol in display units, `Param.cpp` normalizes it with the curve, and modulation is summed in that
normalized space. `shared/protocol/param-curve.ts` is the same arithmetic, and is what the canvas drags a
knob along, so what a hand sets is what the engine gets. `Quartic` is for a range whose useful part is at
the bottom and whose bottom is zero -- an envelope time to eight seconds -- where `Log` cannot start.
`ParamState` stores the normalized target and a 5 ms smoother.
Modulatable params get an implicit input port `param:<id>`; effective value = `denormalize(clamp(knobNorm + signal))`, lane-wise.
Modules read `ctx.param(i).at(frame)` as a `Sample`. `ParamView::knob` carries the *unmodulated* value for the block,
so a module that has to hand the knob and the modulation to a downstream engine separately recovers the modulation
as `at(i) - knob`. A module subscribed on the `params` channel of `telemetry.subscribe` publishes the effective value of every
param after `process` (`TelemetryKind::Params`, written by the scheduler; see docs/telemetry.md), which is how the
interface draws a knob where modulation put it. That is a channel of its own, so a module that also draws
something about itself does both rather than choosing. The same values are left on the instance
(`ModuleInstance::liveValues`), where the message thread's `PreviewPublisher` reads them to redraw the
module's picture (`Module::preview`) whenever they move, so a face follows the sound rather than the document.

**`kParamPrimary` marks a control that belongs on the module's face.** A patching interface draws a
module the size of a business card, and a wavetable oscillator has twenty-odd parameters, so it can
only show a few. Which few is the module's own knowledge: nothing in a parameter table says that a
filter's cutoff is reached for more often than its formant spread, and an interface guessing "the
first few modulatable ones" put an oscillator's detune and distortion on its face while its level and
tuning sat in the inspector. So each module says. Vendored modules name theirs with `ModuleSpec::face`
(control suffixes); our own set the flag directly. Unflagged parameters are not lesser, they are just
reached through the inspector.

`kParamStructural` marks a param that cannot be applied to a live instance (an LFO shape, a wavetable choice):
`InstanceTable::acquire` builds a fresh instance instead of reusing the old one. A structural param may never be
`kParamModulatable` -- `Registry::add` rejects that -- because it is read once, on the message thread, by
`Module::configure(const ParamValues&, const NodeData&)`, which runs before `prepare()`.

**A vendored module's params are in the vendored pre-scale domain, and the unit label can be misleading.**
Descriptors for vendored modules are generated from the vendored parameter table, taking min, max, default
and unit straight from it, with a linear curve because the vendored code applies its own scaling
internally. For a param whose scaling is not linear, the number is therefore not in the unit the label
names -- and a knob is drawn and dragged on the descriptor's curve, so it will be wrong in the same way.
Check the vendored `ValueDetails::value_scale` of any generated param whose unit matters.

The envelope used to be the sharpest case: its times said "seconds" and ran 0 to 2.378, while the real
time was the fourth power of the value, so 0.25 was four milliseconds. That is what `env.adsr` was
written to end -- it owns the vendored `Envelope` processor directly and declares its own params in real
seconds on a `Quartic` taper (docs/adrs/0008). A generated descriptor whose scaling is not linear needs
the same treatment: a spec cannot fix it, because the scaling lives in the vendored control chain.

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
`transport.ppq` every block, so a rebuilt instance resumes where the old one was rather than restarting.
What the position cannot carry is what the old instance was in the middle of -- the notes it had started and
not yet ended -- and that is what `Module::adopt` is for: at the swap, on the audio thread, the rebuilt
instance is handed the retiring one and copies its held set (see "Program and hot-swap"). `notes.clip` and
`notes.pattern` are built this way: the new instance releases whatever the edited source no longer has at
that place and keeps sounding whatever it still does, so an edit under a held chord never leaves a voice
stuck downstream. Unlike
`params`, `data` is genuinely diffed here, so the model cannot get ahead of the engine the way param values can.
If editing ever proves too slow, the upgrade is the pattern the program swap already uses: build the new list on
the message thread, swap an atomic pointer, retire the old one.

## Program and hot-swap

`GraphModel` → `compileGraph` → `Program` (Block buffers, event buffers, ops, feedback states) on the message thread.
`Engine::commit` publishes with one atomic exchange; the audio thread adopts it at the next block and retires the old one.
When the retire queue fills, `Engine` keeps a `deferred_` program and adopts it on a later block; `commit()` runs `collectGarbage()` at entry.
`InstanceTable` reuses a `ModuleInstance` when `(id, type)`, every `kParamStructural` param value and `NodeModel::data` are unchanged;
a change of sample rate or voice count makes it create fresh instances (DSP state resets).
**A rebuilt instance adopts from the one it replaced, at the swap.** `swapIfPending` calls `Program::adoptFrom`
on the incoming program before the old one is retired: every instance whose node id is in the old program under
the same type, and is not the same instance, gets `Module::adopt(retiring)` on the audio thread. Matched there,
against the program that actually ran, rather than recorded at compile time, because two commits can land
before one swap and the instance the second replaced never ran a block. `adopt` copies and never moves,
bounded by the new instance's own sizes: a swap the full retire queue defers runs it again, with the old
instance one block further on. The default carries nothing; the note sources carry their held notes.
Feedback memory is reused by edge id. Param changes never compile: `Engine::setParam` enqueues `{serial, param, norm}`; the audio thread applies it by binary search.

**Model params are applied at instance creation, and reconciled on every commit.** `InstanceTable::acquire` copies
`NodeModel::params` into a `ModuleInstance` when it creates one and never touches a reused instance: after `prepare`,
`ParamState` belongs to the audio thread (the param drain writes it every block), so the message thread must not write
it. Anything that changes model params without going through `Engine::setParam` — `patch.batch`, `patch.load`,
`loadPatchJson` — is caught by `Engine::reconcileParams` at the end of `commit()`: it diffs the model against
`ModuleInstance::appliedValues` (the message thread's "last applied" snapshot) for every non-structural param and pushes
each difference through the param queue, exactly as a knob does. `setParam` keeps the snapshot current on its own path.
A dropped `E_QUEUE_FULL` enqueue leaves the snapshot unchanged, so the next commit retries it.

## Play and Stop

`Engine::setRunning(false)` **holds** the patch: `renderBlock` swaps a pending program and drains the
param queue as usual, then writes silence and runs no module at all. It is not the transport's `playing`
and must never become it -- an offline render has a stopped transport and has to run, and `phase.clock`
and `notes.clip` deliberately free-run off `samplePos` so a patch keeps moving with nothing rolling.

The distinction is the whole point. A modular graph is not gated by its clock, so stopping the transport
leaves an oscillator droning, and `setOutputGain(0)` leaves it droning unheard: everything a running
patch drives goes on running. That was invisible until the interface began drawing what the engine is
doing, at which point a stopped project sat there with its modulated knobs turning and its faces
animating with nothing to hear. Holding is what actually stops it, and because every module keeps the
state it had, Play continues rather than restarts -- `test_hold.cpp` proves that by rendering the same
patch twice, once straight through and once held in the middle, and requiring every sample after the
hold to match.

A held patch publishes nothing (the scheduler is what writes `Params`), so the knobs stop where the
document has them; `PreviewPublisher` switches to the model's values, so a face shows what the patch is
SET to and follows a knob turned in the silence, which is how a patch gets built before anyone presses
Play. `audio.setRunning` is the command; the interface's one transport button sends it along with
`transport.play`/`stop` and the gain.

## Feedback

Tarjan SCCs. Nodes in an SCC (or with a self loop) form a cluster run once per sample (`feedbackMode: sample`) or per block (`block`).
Back edges read from / write to a `FeedbackState`: an exact one-sample (or one-block) delay.
A `FeedbackState` holds **one delay slot per voice pair** (`z[pair]`), because the pairs share the program's
signal buffers but must not share memory that crosses from one pair's run to the next -- with a single slot,
pair 0's delayed sample lands in pair 1's loop. `InstanceTable::acquireFeedback` keeps the state alive across
compiles, keyed by edge id, and builds a *fresh* one when the voice pair count changes rather than resizing
one the audio thread may still be reading through an older program.

**Known limitation: transport-driven modules do not belong inside a sample-level cluster.** In
`feedbackMode: sample` the scheduler runs a cluster's ops once per sample, handing each module
`numFrames == 1` and no indication of where in the block that sample sits. A module that derives its
position from the transport therefore computes the same position 128 times instead of advancing, and
because `ClearEvents` only runs at offset 0, any events it emits are pushed once per sample rather than
once per block. `phase.clock`, `note.toCv`, `note.toPoly` and `notes.clip` all share this exposure. It is
harmless today because nothing puts a clock or a note source inside a feedback loop, and the fix is to
carry the block offset in `ProcessContext` so such a module can advance correctly. Do not add a
transport-driven module to a sample-level cluster before that lands.

## Compilation constraints

- Max `kMaxVoices` = 32 voices (16 pairs) per instrument; `compileGraph` rejects a larger `voices` with `E_VOICES`.
- A node two instruments reach is `E_INSTRUMENT_MIX`; a feedback loop across an instrument's edge is `E_FEEDBACK_DOMAIN`.
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
`unit`, `curve`, `uiWidget`, `enumLabels` and the six `flags`. Every module carries its `face`: the rows of tokens the
descriptor declared, padded to a rectangle, or `null` for a module that left its face to the interface (see
docs/adding-a-module.md, "The face"; the registry has validated it, so the interface only has to place the blocks).

The catalog is the one place the vendored DSP's own parameter table reaches strings the user interface displays, and
`scripts/check-trademark.mjs` reads sources rather than generated documents — so `test_catalog.cpp` scans the
generated JSON for the vendored names itself.

## Tests

`npm run engine:test` runs 160 Catch2 tests. `PG_WERROR=ON npm run engine:test` additionally builds with `-Werror`
(CI does this; it is off by default because `postinstall` builds the engine on end-user machines).

Headless render, using a patch built from builtin modules only:

```
./build/engine/phasegrid-engine --render engine/tests/golden/synth_voice.json --seconds 1 --out out.wav
```

`engine/tests/golden/synth_voice.json` is one whole synth voice: gate and pitch (constants from `math.scaleOffset`
nodes with nothing plugged in) into `osc.wavetable` (saw), into `filter.multi` (12 dB low pass at MIDI 83), into
`amp.vca` whose gain is `env.adsr` on the same gate, into `io.audioOut`. `engine/tests/test_golden_synth.cpp`
renders it and asserts on the signal rather than the file size: it is audible (RMS), it is a *note* (near-silent
through the 62 ms attack, decayed to the sustain level by 450 ms and flat from there), it is *pitched* (the strongest
partial of the settled note is within 15 Hz of 523.25 Hz, the pitch the patch asks for), it is *filtered* (a thousand
times more energy below 1 kHz than above 8 kHz, and opening the cutoff on the same running engine raises the high band
a hundredfold — which a source that simply had no harmonics could not do), and both channels carry it.

The voice has no note path in it: it predates `notes.clip`, and it stays as the monophonic reference.

`engine/tests/golden/poly_chord.json` is the polyphonic one: `notes.clip` holding a C major triad into
`note.toPoly`, its pitch into `osc.wavetable` and its gate into `env.adsr`, through `filter.multi` and
`amp.vca` into `io.audioOut`, at three voices -- so it also renders an odd voice count's empty lane.
`engine/tests/test_golden_poly.cpp` asserts the three fundamentals are *individually identifiable* rather
than that the render is loud: each peak lands within 3 Hz of its note and stands a hundred times above the
loudest bin in the bands BETWEEN the notes, where the patch plays nothing, which is a resolution
measurement rather than a level one. Two controls rule out the ways that could pass unwired: transposing
the clip two semitones on the same running engine has to move all three peaks and empty all three bins they
left, and dropping the program to a single voice has to leave only the note that stole it. Render it with:

```
./build/engine/phasegrid-engine --render engine/tests/golden/poly_chord.json --seconds 2 --out chord.wav
```

`engine/tests/golden/silence.json` is a bare `io.audioOut`, so it writes silence. `engine/tests/golden/const_to_out.json` is a **test-only** fixture: it uses `test.const`, which only
`pg_tests` registers, so `--render` on it exits 1 with `E_UNKNOWN_TYPE` — which is why the synth voice deliberately
uses no test module.

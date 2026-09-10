# Telemetry

How the interface watches the running audio: meters and scopes, at frame rate, with no message passing
per frame.

The engine writes fixed-size slots into a shared-memory segment from its audio thread. The renderer maps
the same bytes read-only through a small Node-API addon and decodes them. Nothing is copied through the
socket, because a meter redrawn sixty times a second through a request and reply would be sixty round
trips per second per meter.

## The shape of it

- `engine/src/services/Telemetry.hpp` writes. `shared/protocol/telemetry.ts` reads. They describe one
  layout in two languages, and the engine asserts the relationships between the sizes at compile time so
  the two cannot drift apart quietly.
- `native/binding.cpp` is the addon: it maps a named segment read-only and copies bytes out of it. It
  copies rather than exposing a view, because the engine keeps writing and a view would change under a
  caller mid-decode.
- `display.meter` and `display.scope` are the modules that publish. They have no outputs, so tapping a
  wire cannot change what it sounds like. The scope keeps the window itself: a block is a few
  milliseconds, a fraction of one cycle of anything worth looking at, and a reader at frame rate
  would see one block in six, so a window stitched on the reading side would be mostly holes. The
  module keeps a ring of `kTelemetryScopeFrames`, decimated so that its `time` knob fills it, and
  publishes the whole ring every block; `writeScope` takes the ring's oldest frame so it is written in
  order without a copy. The face (`scope` in its rows, `kModulePublishesScope`) reads it as a trace,
  triggered on a rising zero crossing so a tone holds still.
- `display.value` publishes a `Value` slot: the last frame of the block, one float per channel, signed.
  Its own kind rather than a meter, because a meter's peak is a magnitude and +0.5 and -0.5 read the
  same through one, while the sign is most of what a control voltage is read for. Its face
  (`value`, `kModulePublishesValue`) prints it.
- `display.piano` publishes a `Keys` slot: one float per MIDI note number, 1 for a key that is down,
  128 of them. Per note rather than per voice, so a reader never has to know how many voices the
  program runs or which lane is which: the module reads each voice's pitch and gate at the block's
  last frame, across every voice pair, and publishes once on the last. Its face (`piano`,
  `kModulePublishesKeys`) lights the keys; the keyboard's range is the module's own parameters,
  read from the document, and never crosses telemetry.
- A subscribed module publishes a `Params` slot: the effective value of every one of its parameters, in
  display units and descriptor order, after whatever is plugged into its `param:` inputs has been added.
  The scheduler writes it after the module's `process`, from voice pair 0's lane 0 and the block's last
  frame, so no module knows it is being watched. It is what lets a knob on the interface turn when
  something modulates it. Inside a sample-level feedback cluster the write happens once per sample
  rather than once per block, which is correct and merely busier.
- A module that draws an **envelope** (`previewsEnvelope`) writes the same buffer through the same
  `Module::preview` and publishes it as `TelemetryKind::Envelope`: a header of `kEnvelopePictureHeader`
  floats -- where each stage ends and the level it sustains at, all fractions of the drawn width, plus
  the playhead and the stage -- and then the curve. Not samples alone, because an envelope is not one
  cycle of anything: without the breakpoints a reader could draw the curve but not say where the decay
  ends, so it could not dash the sustain or put a dot on a corner. The playhead is a relaxed read of what
  the audio thread left on the module, so the picture animates at the publisher's rate rather than the
  block rate. It rides the *preview* channel and not `display` on purpose: a held patch runs no module,
  and the shape still has to follow a knob turned in the silence.
- A module with a wave panel (`previewsWave`) can be asked for its picture as well. The engine's message
  thread (`PreviewPublisher`, ticked from the command loop about thirty times a second) reads the values
  the audio thread left on the instance, asks `Module::preview` when they have moved, and writes one cycle
  into a `Preview` slot. That is how a face follows the sound under modulation, under a hand, and while a
  smoother is still ramping. `hello` lists `previews` among the capabilities when this is on; a renderer
  falls back to `module.preview` over the socket when it is not. An envelope's publisher is asked on
  every tick rather than only when its values move -- its playhead travels while every knob stands still
  -- and publishes only when the picture it produced differs from the last one, so a resting envelope
  costs one comparison and no write. A held patch (`audio.setRunning`) runs no
  module, so nothing publishes `Params` and the knobs rest where the document has them; the pictures keep
  coming, drawn from the model's values, so a face still follows a knob turned while the patch is stopped.

## Channels

Those three publishers are different things about the same module, so they are named separately and get
a slot each. A **channel** says who writes and why; a `TelemetryKind` says what the bytes are, and the
two are not the same axis -- `display` carries four kinds depending on the module.

- `params`: the scheduler, after `process`. Any module with parameters.
- `display`: the module itself, on the audio thread. A `kModuleWritesTelemetry` module only.
- `preview`: `PreviewPublisher`, on the message thread. A `previewsWave` or `previewsEnvelope` module only.

`telemetry.subscribe` takes `watch`, a module id to the channels wanted of it, and answers the slot for
each pair; that map is the only place the module-to-slot mapping exists. The list lives once, in
`engine/src/core/TelemetryChannel.hpp` and `shared/protocol/telemetry.ts`, with `moduleServes` saying
which module can serve which -- a pair it cannot is refused rather than answered with a slot nothing
writes into.

One channel per slot is the point. A pattern draws its own piano roll AND has a Legato an LFO can turn,
and while a module had a single slot the picture won: the scheduler skipped any module that published a
kind of its own, so no knob on a face that drew anything could ever move. Two channels, two slots, both
live.

- The renderer owns the subscription set in one place (`src/renderer/src/grid/telemetry-sync.ts`), and
  computes it with one pure function per channel: `modulatedModules` (which knobs have a cable, and
  which parameter each is), `displayModules`, `previewedModules`. They are folded into the one `watch`
  and the reply into one slot map per channel. `telemetry.subscribe` replaces the whole set, so two
  subscribers would cancel each other. The display tick dispatches on the slot's kind, so another
  display module is a flag and a case rather than a second path.

## Why a seqlock

The audio thread cannot wait for a reader, and a reader must never be able to stall the audio thread.
So a slot carries a counter: the writer makes it odd, writes the payload, then publishes an even value.
A reader takes the counter, copies the payload, and takes the counter again. If it was odd, or if it
moved, the copy is part old and part new and is discarded. A reader can be slow, or crash, and the audio
thread never notices.

The ordering on the publish is load-bearing and cannot be verified by a test. Weakening it fails nothing
in this repository, which was checked by doing it; whether the reordering actually happens depends on
the compiler and the processor. A thread sanitizer does not settle it either, because a seqlock reads
the payload while the writer is writing it deliberately, so a sanitizer reports a correct implementation
as a race. The ordering is required by the memory model, and a green test suite is not permission to
remove it.

## What a reader must not assume

The segment is written by another process which may have died halfway through a write. So the decoder
checks the magic, refuses a layout version it does not recognise rather than reading fields at the wrong
offsets, and bounds-checks every length before indexing. A channel count of four billion has to produce
"nothing to draw", not an exception and certainly not a read past the buffer.

Module names are not in the segment. The map from module to slot comes from `telemetry.subscribe` and
only from there. A reader parsing bytes from another process should not also be trusted to say what
those bytes represent.

## Lifetime

The segment is named for the engine's process id. Creating one unlinks any segment already at that name
first: opening shared memory attaches to an existing segment rather than failing, so a crashed engine's
segment would otherwise be adopted by its replacement and both would write into it.

`heartbeat` counts rendered blocks. A reader watches it to tell "these values are live" from "the engine
died and these are its last", which the values themselves cannot say.

## Trying it

```
node scripts/engine-cli.mjs --demo
```

builds a patch and plays it. To watch a meter, subscribe over the socket and read the slot the reply
names. The engine's own tests cover the writer and the seqlock; `shared/protocol/telemetry.test.ts`
covers the decoder against fixture buffers, including a torn one and one with a bad magic.

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
  wire cannot change what it sounds like.
- Any other subscribed module publishes a `Params` slot: the effective value of every one of its
  parameters, in display units and descriptor order, after whatever is plugged into its `param:` inputs
  has been added. The scheduler writes it after the module's `process`, from voice pair 0's lane 0 and
  the block's last frame, so no module knows it is being watched. It is what lets a knob on the
  interface turn when something modulates it. Inside a sample-level feedback cluster the write happens
  once per sample rather than once per block, which is correct and merely busier.
- The renderer owns the subscription set in one place (`src/renderer/src/grid/telemetry-sync.ts`):
  `telemetry.subscribe` replaces the whole set, so two subscribers would cancel each other.
- `telemetry.subscribe` decides which module writes into which slot and returns the map.

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

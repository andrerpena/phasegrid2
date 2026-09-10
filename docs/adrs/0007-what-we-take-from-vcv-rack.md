# 0007. What we take from VCV Rack, and what we leave

2026-09-10. Accepted.

## Context

VCV Rack's source was read in full enough to answer one question: it is proven software, a stable API
with years of production behind it and thousands of third-party modules, so what should we take from it?

Answering it meant reading a large codebase to find the few places worth borrowing. That reading is the
expensive part, and this record exists so nobody does it twice. Rack is a **read reference**, not a
dependency: nothing here adds a submodule, a build input or a package.

**The licence gates everything, so it comes first.** Rack Free is GPL-3.0-or-later. phasegrid2 is
AGPL-3.0-only, and GPLv3 section 13 permits the combination -- the same arrangement we already have with
the vendored Vital DSP. Three things are *not* under that licence and are off limits: the component
library graphics (CC BY-NC), the Core modules' visual design (CC BY-NC-**ND**, so no derivative at all),
and the "VCV" name, which is trademarked. The rule is therefore the one we already apply to Vital:
source may be used with attribution, nothing visual may be, and the name never appears in a module id,
the interface, or a binary.

## Decision

**Take now: flush-to-zero on the thread that renders.** `engine/src/rt/Denormals.hpp`, called at the top
of `Engine::renderInterleaved`. A denormal is a number too small to represent normally, handled by the
hardware on a slow path costing around a hundred cycles per operation on x86-64. They appear precisely
where audio decays towards silence rather than stopping: a reverb tail, a delay's feedback, an
envelope's release. So the cost lands when the patch goes quiet, is heard as a crackle from a missed
deadline rather than as a wrong number, and is very hard to attribute afterwards. Rack sets the flags at
the top of every block (`src/system.cpp:937-976`); we set nothing, anywhere, in our code or in the
vendored DSP.

Measured, not assumed: with the call removed, `[denormals]` in `engine/tests/test_rt_alloc.cpp` fails on
this machine. Apple Silicon under macOS does **not** default to flush-to-zero, so every reverb tail we
have rendered has been taking the slow path.

The x86-64 half is written with Intel's documented intrinsics rather than Rack's raw bit constants; the
approach and the ARM64 register form are Rack's, and the file says so.

**No `engine/vendor/rack/`.** Vendoring is for a body of code used wholesale and tracked against
upstream, which is what `engine/vendor/vital` is: thousands of lines, unmodified, with a script that
reproduces the copy. What we use from Rack today is fifteen lines of architecture-defined register bits.
Everything else worth having is either for a feature we have not built, or written for their per-sample
model and their SIMD type and would have to be rewritten rather than copied. Vendored code we never call
would still enter the build, the trademark lint and the licence notice, and would rot there.

**Come back for these when we build the feature**, with what to take:

- **MIDI.** We have none; the protocol advertises no capability for it on purpose. Take the shape of
  `include/midi.hpp:257`, `InputQueue::tryPop(message, maxFrame)`: every message carries the engine
  frame it belongs to and is popped when that frame arrives. That is the same problem our `EventBuffer`
  already solves for pattern notes, and hand-rolling the jitter is a week. `include/dsp/midi.hpp:255`
  has the parser and, at `:513-660`, note-to-channel assignment (rotate, reuse, reset), a retrigger
  pulse on every press, and `retriggerOnResume` for mono legato -- the same questions our converter
  answers, worth comparing against before we answer them again.
- **A device that runs at a different rate from the engine.** Today `BackendDeviceHost::select` refuses
  one in so many words. Rack resamples: `include/dsp/resampler.hpp:16` wraps speex, and
  `src/core/Audio.cpp:60-130` shows the buffering discipline on both sides, including when to drop the
  engine buffer to keep latency down. That discipline is the subtle part, not the resampler.
- **Small primitives**, when a second module needs one: `include/dsp/digital.hpp` has a Schmitt trigger
  with hysteresis and a pulse generator. Ours is `gateHigh(v > 0.f)`, a bare comparison, so a gate
  resting at exactly zero with noise on it chatters. They would be rewritten for `Sample`'s four lanes,
  not copied.

**Deliberately not taken**, each for a reason that will not change:

- **Per-sample `process()` and sixteen-channel ports** (`include/engine/Module.hpp:331`,
  `include/engine/Port.hpp:11`). That is the eurorack model, where a voice is not a concept and
  polyphony is a channel count on a cable. [0001](0001-bitwig-grid-is-the-reference-for-voice-semantics.md)
  chose the instrument model instead, and voice lifetime, instrument membership and the per-pair
  scheduler all follow from it. Their model buys free feedback and a simpler module contract; ours buys
  voices that cost nothing while silent, release tails, and block processing that lets us use the
  vendored DSP directly. It is a real trade and we have already paid part of its price in bugs.
- **Worker threads and a barrier per frame** (`src/engine/Engine.cpp:428-590`). We run one block, one
  thread, and docs/engine.md says parallelising voice pairs would break the per-block contract rather
  than merely speed it up.
- **The undo system** (`include/history.hpp`). `Action`/`ComplexAction` is the same shape as our patch-op
  store, in the wrong language and the wrong layer.
- **Anything graphical**, by licence as much as by design.

## Consequences

- **The audio thread no longer takes the denormal slow path**, on either architecture, in the device
  callback and in the offline render alike. A test asserts it, and fails without it.
- **`renderBlock` is deliberately left alone**, so a test that calls it directly keeps plain IEEE
  arithmetic; the flush belongs to the entry point that plays.
- **This file is the map.** The next person asking "is there anything in Rack worth taking" reads this
  instead of the source, and if they disagree they have the line numbers to argue from.
- **A level observation that bears on an open question.** Rack's convention is that audio sits at plus or
  minus five volts and its output stage divides by ten (`src/core/Audio.cpp:267`), so a full-scale
  oscillator reaches the converter at half scale, with six decibels of headroom built into the
  convention. The reference instrument's own export sat about ten decibels below full scale. Two
  independent hosts keep an oscillator well under full scale by default and we do not, which is evidence
  for the level convention left open in
  [0006](0006-the-output-clips-like-the-reference-instrument.md).

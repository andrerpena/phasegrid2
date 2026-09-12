# 0003. A voice fades out, and the sine starts at zero

2026-09-10. Accepted. Follows [0002](0002-a-released-voice-lives-only-while-a-module-holds-it.md).

## Context

With [0002](0002-a-released-voice-lives-only-while-a-module-holds-it.md) in place, the simplest
polyphonic patch -- a pattern, a converter, a sine, the output, no envelope anywhere -- still sounded
wrong. Not droning any more, but rough, where the same notes from the reference instrument are clean.

The measurement that found it is not one we had. Rendering `c3 e3 b3 c4` through that patch:

| Render | Peak | Largest sample-to-sample step |
|---|---|---|
| the reference instrument | 0.32 | 0.0217, its own slope |
| ours, 16 voices, legato 0.9 | 1.00 | **1.0000**, at every note on and every note off |
| ours, 16 voices, legato 1.0 | **1.85** | 0.9960 |
| ours, 1 voice, legato 1.0 | 1.00 | 0.0538, its own slope |

Peak and RMS were normal in every row. They cannot be otherwise: a signal made entirely of clicks has a
perfectly ordinary peak and a perfectly ordinary RMS. That is why every test passed while the instrument
was unusable, and it is the more important half of what this record decides.

Three steps, three causes, all of them the same mistake in different places -- a voice's audio beginning
or ending at a value that is not zero:

1. **Note on.** `osc.sine` began its cycle at the bottom, `-cos`, so a voice opened on a jump from
   silence to −1.
2. **Note off.** A freed voice stopped dead. Its pair stopped running mid-cycle and the output went to
   zero from wherever the wave happened to be.
3. **A voice taken back inside a live pair.** Lanes belong to a pair and a pair is reset only when the
   whole of it was dead, so a voice reused while its partner was still sounding carried on from the
   phase its lane had been running at, unheard, since its last note. Full legato does this every note.

## Decision

**A voice ramps to silence over `kVoiceFadeSeconds` (3 ms) instead of stopping.** `VoiceActivity` gives
each voice a fade counter; when `settle` finds a releasing voice nobody held, the ramp starts, and the
voice is free when it runs out. The exits multiply by it as they fold, through one `VoiceGain` helper
that carries the lane mask and the ramp together, so `io.audioOut`, `voices.sum` and the test sink
cannot drift apart on it.

The ramp is **committed** once it starts. A holder cannot take it back, because the holder that would is
an exit that stops hearing a voice *precisely because* it is fading; letting that restart the ramp would
put back the click the ramp exists to remove. Only a new note on that voice cancels it.

**A note start stays instant.** A sawtooth and a pulse genuinely begin at a corner, and a synth that
clicks on a raw saw with no envelope is behaving as the waveform says; that is what an envelope is for.

**The sine starts at the rising zero crossing.** Phase 0 is `sin`, not `-cos`. A sine has a quiet place
to begin and there is no reason not to begin there. The reference instrument's sine and Vital's both do.

**A free voice's lanes are held at the start of their cycle.** An oscillator inside an instrument does
not advance a lane whose voice the pool says is free, so a voice taken back mid-pair begins where a
fresh one would. A global module has no pool and no free lanes; its upper lanes mirror its lower ones
and keep running.

**`patch.render` reports `maxStep`**, the largest jump from one sample to the next, per channel, beside
the RMS and peak it already reported.

## Consequences

- The patch that started this renders at 0.0538, its own slope, indistinguishable in smoothness from the
  reference. Full legato renders at 0.0689, which is two overlapping sines' combined slope.
- **A voice outlives its note by 3 ms.** It holds a pool slot and costs its pair's CPU for that long.
- **The sine no longer agrees with the sawtooth and the pulse about phase 0**, which
  `engine/src/modules/OscSine.cpp` had deliberately arranged. Anything driving the Sine's `phase` input
  from another oscillator is a quarter cycle away from where it was, and the face draws a quarter turn
  round. That agreement was never audible; the click was.
- **A test can hear a click now.** `maxStep` is the assertion in the engine's voice tests and in the
  `voice-lifetime` scenario. A wave's own slope bounds it, so the bound is not arbitrary: a sine at
  middle C moves by hundredths between samples and anything near full scale is a discontinuity.
- **Full legato still sums two voices**, peaking near 2.0 where one voice peaks at 1.0. That is
  arithmetic, not a defect: at legato 1 the outgoing voice really is still sounding when the next note
  starts, as it is in any polyphonic instrument.
- **What this does not decide.** A voice stolen while it is still fading has its ramp cancelled and can
  step; it takes notes closer together than 3 ms to reach that, and the fix is a steal crossfade, which
  is a bigger machine than this. Vendored modules have no per-lane reset -- `hardReset` resets a whole
  pair -- so the free-lane rule covers our own oscillators only.
- **This was not what the roughness was.** The clicks were real and are gone, and the patch still did not
  sound right, because `osc.sine` was not a sine:
  [0004](0004-a-waveform-is-measured-by-its-shape.md).

# 0004. A waveform is measured by its shape, and Fold 0 is a sine

2026-09-10. Accepted.

## Context

One complaint -- "the sine sounds rough" -- took three rounds to diagnose, and the first two rounds
fixed real defects that were not the one being reported. That is the expensive part, and it has a single
cause: at every round the measurement we trusted could not see the defect being described.

| Round | What we measured | What it found | What it could not see |
|---|---|---|---|
| 1 | RMS and peak | voices piling up until the sum clipped ([0002](0002-a-released-voice-lives-only-while-a-module-holds-it.md)) | a click: it has an ordinary peak |
| 2 | largest sample-to-sample step | every note beginning and ending on a full-scale step ([0003](0003-a-voice-fades-out-and-the-sine-starts-at-zero.md)) | distortion: a flattened wave has no step in it |
| 3 | crest factor, then the harmonic series | `osc.sine` was not a sine | -- |

The defect round 3 found had been there from the day the module was written, in plain sight, in its own
comment: the wavefolder's drive started at pi/2 rather than at zero, so at **Fold 0 -- its default, the
setting anyone plays first** -- the wave was `sin((pi/2) * sin(2*pi*p))`, a soft-clipped sine carrying a
third harmonic eighteen decibels down. The comment called that "faint" and "paid on purpose" for a knob
calibration. Measured on a sustained middle C:

| | crest factor | 3rd harmonic | THD |
|---|---|---|---|
| `osc.sine` at Fold 0 | 1.24 | -18.2 dB | 12.2% |
| a sine | 1.41 | none | 0% |
| the reference instrument | 1.41 | -39.6 dB | -- |

Twelve percent distortion is not faint. It is the difference between a sine and a different instrument,
on the plainest note anyone can play.

Every test passed throughout. Level tests pass on a flattened wave, which has an ordinary peak and a
slightly *higher* RMS. The discontinuity test passes, because flattening introduces no discontinuity.
Even the aliasing test passes, because the third harmonic is a real harmonic that lands exactly on a
harmonic bin and is counted as signal. We had a test that the *wavetable* sine is a single harmonic, and
none that the *Sine module* is.

## Decision

**A waveform is asserted by its harmonic series, at the setting it ships with.**
`engine/tests/test_osc_purity.cpp` asks of each oscillator the question a listener asks immediately: is
this the wave it says it is? The sine is one partial and nothing above -60 dB; the sawtooth is the 1/n
series; the pulse is the odd harmonics and no even ones. Each is checked twice, once against the series
and once against the crest factor, which owes nothing to the FFT. A new oscillator adds a case here.

**Fold 0 applies no folding.** The drive becomes `pi * (2^(st/12) - 1)`, which is zero at zero, and the
wave is divided by the peak the curve actually reaches so that unfolding does not fade the oscillator
out. Twelve semitones is still exactly a drive of pi, two lobes meeting at the centre line, so the
knob's one real milestone survives.

**Fold's range is three octaves, not four.** Folding raises the wave's fastest moment to roughly the
pitch times the drive, and that has to stay under half the sample rate. Measured at A4, off-harmonic
energy holds above 88 dB through 36 semitones and falls off a cliff to 42 dB at 48. The knob now stops
where the wave is still a wave, which costs the range it used to share with the other oscillators' Sync.

**`patch.render` reports the crest factor**, peak over RMS, beside the level and the step. It is one
division, it is independent of loudness, and it is the number that broke this case open. Harmonic
assertions proper stay in the engine tests, where the note being played is known; a general patch has no
one fundamental, and a THD figure computed for a chord would be a number that means nothing.

**A render is performed under the engine's own transport.** `patch.render` was building a bare snapshot:
tempo 120, not playing, no scale. A note source follows `ppq` while the transport rolls and the sample
clock when it does not, so a render was a different performance from the one the instrument was giving,
at a tempo the project may never have been set to. It now inherits tempo, meter and scale from the live
transport.

## Consequences

- Our sine now measures cleaner than the vendored wavetable's sine: no harmonic above the noise floor,
  crest 1.415 against a theoretical 1.414.
- **Every non-zero Fold setting sounds different**, and patches saved with Fold above 36 clamp. This is
  a deliberate break; the old curve cannot be recovered by moving the knob.
- **A measurement that cannot see the defect is worse than none**, because it is read as evidence. Each
  of the three rounds ended with green tests and a confident wrong report. The guard against a fourth is
  that level, continuity and shape are now three separate questions with three separate numbers, and the
  waveform question is asked of every oscillator by name.
- **What this does not decide.** There is still no way to capture what the running application actually
  plays; every measurement here is an offline render through the same engine, and the transport is now
  the only difference we know of between the two. Closing that would mean a device backend that writes
  what it is handed, which is a small change at `AudioDeviceBackend` and is not made here.
  *It was not the only difference.* The live callback advanced the clock once per callback rather than
  once per block, which no offline render could show, and it was the roughness all along:
  [0005](0005-the-transport-ticks-per-engine-block.md).

# 0009. The reverb is the reference instrument's, on our own network

2026-09-10. Accepted. Follows [0001](0001-bitwig-grid-is-the-reference-for-voice-semantics.md) and
[0008](0008-the-envelope-is-the-reference-instrument-s-adsr.md).

## Context

The user's words were that our reverb "kind of sucks, it's a bit buggy, it clips the audio a bit, it's
not clear what it does". All three are measurable, and measuring them is where this starts.

`fx.reverb` was `vital::ReverbModule` published straight through `vendor::buildDescriptor` — twenty-two
lines of adapter over `engine/vendor/vital/src/synthesis/effects/reverb.cpp`. A plucked C3 through
`voices.sum` into it and out through `io.audioOut` with clipping off, rendered at 48 kHz and measured
with `scripts/audio-measure.mjs`, said this:

| Decay Time | 0.25 s | 1 s | 4 s | 16 s | 64 s |
|---|---|---|---|---|---|
| wet RMS | 0.047 | 0.074 | 0.145 | 0.272 | **0.395, 1.1 % of samples over full scale** |
| R minus L, mono in | **+7.5 dB** | +4.7 dB | +3.2 dB | +3.2 dB | +2.5 dB |

and, with Decay Time asking for 4 seconds, Size alone moved the measured T60 to **16 s / 6.7 s / 4.6 s**
at Size 0 / 50 / 100 %.

Each has a cause in the vendored file, and none of them is reachable from a `ModuleSpec`:

- **Nothing normalises the level.** A feedback network's steady-state amplitude grows as the square
  root of its decay time and nothing divides that back out, so Reverb Time doubles as a volume knob and
  eventually as a clipper. Theory and the sweep agree: 256× in time predicts +24 dB, and +18.5 dB is
  what an eight-second window of it measures.
- **The allpass diffusers are inside the feedback loop and are not scaled with Size**
  (`kAllpassDelays[i] * buffer_scale`, no `size_mult`), while the T60 exponent counts only the feedback
  delay. The round trip is therefore longer than the arithmetic assumes, by 2.88 / 1.47 / 1.12 at those
  three Sizes — which is exactly the 4× / 1.7× / 1.15× the tail was measured to overshoot by.
- **The network is not left/right symmetric.** Output L is lanes 0+2 and R is lanes 1+3, and the two
  lane sets draw different lengths from `kFeedbackDelays`; with the unscaled allpass inflating short
  lines more than long ones, the two sides end up with different decay and different level. A mono
  source is not centred, and always leans the same way.
- **Its knobs are in the vendored pre-scale domain**, which is the problem [0008](0008-the-envelope-is-the-reference-instrument-s-adsr.md)
  closed for the envelope and `docs/engine.md` records as open for everything else. Decay Time was
  labelled `seconds`, ran −6…6 on a linear taper, and meant 2^v. The four cutoffs were MIDI note
  numbers; Size was 0…1 for a 0.125×…2× span.
- **`Reverb::kStereoWidth` is declared in the vendored input enum and never plugged or read.** There
  was no Width at all.
- Two more, found while reading and not separately measured: four smoothing deltas
  (`delta_low_coefficient`, `delta_low_amplitude`, and both pre-filter deltas) are computed and never
  added inside the sample loop, so the low shelf and both pre-filters step once per block instead of
  ramping; and the pre-filter subtracts its two one-poles the wrong way round (`LP(low) − LP(high)`
  where a band wants `LP(high) − LP(low)`), so the wet came out polarity-inverted against the dry.

Above all that, the reference instrument's Reverb has an **Early section** — Mode, Size, Pre-delay,
Diffusion — and a **Late Mix** between it and the tail, and the vendored reverb has no early
reflections of any kind. Its band controls only ever *attenuate* (`low_shelf_gain` and
`high_shelf_gain` run −6…0 dB), so a band that rings **longer** than the middle one, which the
reference allows to 1.78×, cannot be expressed at all.

`engine/vendor/vital` is not ours to edit — `NOTICE.md` lists the only seven files we have touched, all
of them missing `#include`s, and a re-vendor overwrites them.

## Decision

**`fx.reverb` is a native module that owns vendored primitives.** [0008](0008-the-envelope-is-the-reference-instrument-s-adsr.md)
established that a module may own a vendored `Processor` directly when its phasegrid-facing surface
differs from the vendored one's; this goes one step further and owns `poly_float`, `OnePoleFilter`,
`futils` and `utils` while writing its own topology, because the topology is where the faults are. Every
line of arithmetic that can stay vendored has.

`engine/src/modules/FxReverb.cpp` is the whole of it. The chain, one stereo instance per voice pair:

```
in ─► pre-delay ─┬─► diffusers (Diffusion) ─► early taps (Mode × Size) ──┐
                 └─► diffusers (Buildup) ─► tank (Time, 3-band decay) ───┤
                              Late Mix, equal power ─────────────────────┘
                              ─► Width (M/S) ─► Mix ─► out, and a meter
```

Four things about it are decisions rather than detail.

**The diffusers are on the tank's input, never in its loop.** A line's round trip is then exactly its
own delay, so the T60 solved for is the T60 heard. This is the fix for the Size interaction, and it is
also why Size does not touch the tank: the reference's own documentation says Room Size is "the
relative size of the space being simulated for **Early** reflections", and the tail's density is
Buildup's business. Following that removes the interaction rather than compensating for it.

**The feedback matrix is a Hadamard, not a Householder.** The first attempt reused the vendored
reverb's `x − (2/N)Σx`, which is orthogonal but is a *reflection*: it mixes only what lies along its
one axis, and the tank is fed with a zero-mean pattern of signs that lies exactly orthogonal to it. The
measured result was eight independent comb filters — L and R anti-correlated at −0.42, which a meter
sees as a hollow, phasey tail. A Hadamard has no such blind spot. It is three butterfly stages of
adds, so it costs nothing.

**The decay is three bands per line, as two cascaded first-order shelves and a scalar.** A shelf
written `x + (a − 1)·lowpass(x)` has squared magnitude `1 + (a² − 1)cos²φ` for a one-pole, so it runs
monotonically between 1 and `a` and overshoots neither — which is what makes a band factor **above** 1
safe, and it is the thing the vendored shelves could not do. `bandGains` still bounds the worst case
(`max(1, lowRel)·max(1, highRel)·mid`) and scales back if it would reach one; at the far corner of the
surface, 31.6 s with both bands asking for 1.78× more, that product comes to 0.99976 on its own.

**The tank's input is scaled by `(kReferenceTime / time)^0.58`.** 0.5 is the exponent the physics
gives and most of what this does. The rest is measured: over the knob's full hundred-to-one range the
square root alone leaves a +3.2 dB drift, because a tail shorter than the sound exciting it never
reaches the steady state the model assumes. 0.58 flattens it, and `kTankDrive` and `kEarlyDrive` are
likewise measured — chosen so each section on its own sits about where the dry signal did, which is
what makes Late Mix a crossfade rather than a volume control.

**The surface is the reference's, in real units.** Mode (Room/Hall), Size 0–200 %, Pre-delay 0–100 ms,
Diffusion, Buildup, Reverb Time 0.316–31.6 s, Low and High Band Split in hertz, Low and High Band
Factor 0.562–1.78×, Late Mix, Width 0–150 %, Mix. Every range is the reference's own, and they are
decade-symmetric — ±1.78× is 10^±0.25 — so `ParamCurve::Log` puts 1.0 in the middle of the factor knobs
without any arithmetic of ours. `ParamUnit::Milliseconds` is added for Pre-delay: four milliseconds
reads as "4.00 ms" on every instrument that has one and "0.004 s" on none of them.

Two controls go past the reference's panel: **Modulation** and **Modulation Rate**, the drift that
keeps a long tail from ringing metallically. They are not on the face, because the face is the
reference's; they are in the inspector, because a long tank needs them.

## Consequences

- **Every param id changed and there is no shim.** A patch naming `dry_wet`, `decay_time` or
  `pre_low_cutoff` stops loading. That is the clean break `CLAUDE.md` asks for; the examples and the
  golden catalogue are repointed.
- **The `voices.sum` example patches the reverb into both `inL` and `inR`.** It went to `inL` alone,
  and `io.audioOut` mirrors the left lanes when `inR` is empty — so the reverb's whole stereo image was
  being thrown away by the one example that shows it off.
- **The three measured faults are closed**, on the same render, with the same script:

  | | before | after |
  |---|---|---|
  | wet RMS across the whole time range | +18.5 dB | +1.9 dB |
  | samples over full scale | 1.1 % | 0 |
  | mono in, L against R | +2.5…+7.5 dB, always the same way | ≤1.2 dB, scattering either way |
  | T60 against the knob, across Size | 4× / 1.7× / 1.15× out | Size no longer touches the tail |

- **A held tone is not a fair probe of a reverb, and the tests say so.** One note excites only its own
  harmonics, and those land on peaks of one channel's comb structure and in notches of the other's: a
  single sustained sawtooth reads ±2 dB of imbalance and ±3 dB of level drift from a network that is
  neither. `test_fx_reverb.cpp` averages every measurement over six pitches for that reason, and its
  level bound is deliberately looser than the number a musical source gives. To measure it properly,
  render plucked chords and integrate the tail:
  `./build/engine/phasegrid-engine --render <patch> --out x.wav --bars 24 --period 512 --set verb.time=<t>`.
- **`fx.reverb` left `test_vital_effects.cpp`**, whose `Fx` helper moved to `engine/tests/util/Fx.hpp`
  and gained a source table and transpose so any effect can be measured across the spectrum.
- **The early tap sets are our reading of two words.** Room is eight reflections between 7 and 47 ms,
  Hall eight between 17 and 126; the reference documents "the type of space being simulated" and
  nothing more. `fixtures/reference/fx.reverb/{room,hall}` holds a case each with no recording in it,
  and `npm run compare:reference -- fx.reverb` decides once one is dropped in — the same arrangement
  [0008](0008-the-envelope-is-the-reference-instrument-s-adsr.md) left for the envelope's three models.
- **A third way to use the vendored library is now established**, and `docs/adding-a-module.md` says so:
  a native module may own vendored primitives and write its own topology, when the topology is the
  thing that is wrong.
- **The reverb still hears one voice of each pair**, mirrored onto the other, which is what every
  vendored effect does. Its documentation says to put it after `voices.sum`, and the example does.

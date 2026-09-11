# 0010. The effects come from a library, not from us

2026-09-11. Accepted. **Supersedes [0009](0009-the-reverb-is-the-reference-instrument-s.md).**

## Context

[0009](0009-the-reverb-is-the-reference-instrument-s.md) had us write a reverb. It was careful work:
the vendored network's three measured faults were each closed, the level held flat across a
hundred-to-one range of decay times, a mono source came out centred, and every test passed.

Then the user opened it and turned the knobs. *"You made a Reverb module with 12 knobs, and they
mostly do not make audible difference at all. But most importantly: I don't hear any fucking reverb."*

They were right, and the DSP was not the problem. One note into silence, dB per half second, shows
Decay Time doing exactly what it says:

```
time=0.316   -17.9  -93.8  -189.8      time=5     -17.8  -22.9  -27.7
time=1.26    -15.9  -37.6   -59.5      time=31.6  -24.9  -25.2  -25.1
```

The problem was the **example**. `throughExample` wired a bare `osc.wavetable` — a sustained sine,
no notes, no gate, no gaps — into the effect, and out to `inL` alone. A reverb tail is audible only
in the gaps, and there were none; the stereo image was discarded on the way out. On that source,
Reverb Time, Size, Diffusion and Buildup *are* inaudible, while Pre-delay comb-filters, Width moves
the image and Mix changes the level. That is the user's report, item for item.

And every test shared the blind spot. They measured aggregates — RMS, stereo balance, correlation —
on the same steady source. Not one of them asked *does turning this knob change what you hear*.

So two decisions, and the second matters more than the first.

## Decision

**The effects come from `sst-effects`, and phasegrid writes an adapter rather than DSP.**

The Surge Synth Team publish their DSP as header-only template libraries with an explicit
host-adapter contract (`sst/effects/EffectCore.h`): each effect takes a configuration type answering
about fifteen questions — sample rate, where the parameter values are, how to turn a note into a
pitch — and Surge's own `SurgeFXConfig` is just one implementation of it. `engine/src/sst/Config.hpp`
is phasegrid's, and it is the whole of the coupling.

`engine/src/sst` mirrors `engine/src/vital` file for file, because that layer had already solved this
problem once. The one difference is the one that matters. A Vital control carries the library's raw
pre-scale number under a unit label that often does not describe it — the problem `docs/engine.md`
records, that [0008](0008-the-envelope-is-the-reference-instrument-s-adsr.md) fixed for the envelope
by hand and that 0009 fixed for the reverb by hand again. An sst effect describes its parameters with
`ParamMetaData`: name, range, unit, and the display scaling. So `buildDescriptor` publishes the
*display* range and the taper that reproduces it, and `WrappedEffect` converts back on the way in.
Reverb 2's Decay Time is −4…6 natively and reaches the page as 0.0625–64 s on a logarithmic taper.
A scaling we have not met throws at registry time, so an effect that would need a new one is a build
that fails rather than a knob that lies.

Three adaptations, and they are all translation. **Lanes**: our `poly_float` is `v0.L v0.R v1.L v1.R`
and an effect wants two float arrays, so the block is deinterleaved and re-interleaved, reading the
pair's first voice and mirroring — the convention every effect here follows. **Blocks**: an effect
runs a fixed 32 frames, our block is 64, so the common path runs it twice with no latency; a module
inside a *sample-accurate* feedback cluster is run a frame at a time (`Scheduler::runCluster`), and
there is a FIFO for that, costing 32 samples there and only there. **Holes**: an effect's parameter
list can have gaps (the delay's slot 9 is a control that was removed), so `publishable` skips them
and the wrapper keeps a map from our index to the effect's.

**`fx.reverb` is Surge's Reverb 2, and `engine/src/modules/FxReverb.cpp` is deleted.** Nine effects
arrive with the adapter: Reverb 2, Reverb 1, Delay, Floaty Delay, Flanger, Phaser, Bonsai and Rotary
Speaker replace or join the rack. `fx.chorus`, `fx.compressor` and `fx.eq` stay on Vital, which has
no sst equivalent yet.

**And a module is not done until a probe says its knobs work.** `npm run module:probe -- <id>`
(`scripts/module-probe.ts`) audits the example first — a time-domain effect needs a gated source and
both output channels — and then sweeps every parameter across its own taper, comparing each render
with the untouched one. A knob whose whole range barely moves the output is reported DEAD.

## Consequences

- **Vital shrinks to the voice path** — the `poly_float` wire type, `osc.wavetable`, the envelope
  behind `env.adsr`, `mod.lfo`, `mod.random`, `sampler.player` — and is not removed. There is no
  extracted sst oscillator library (the only generator in that tree is `TiltNoise.h`), Surge's own are
  bound to `SurgeStorage`/`SurgeVoice`/`QuadFilterChain`, and the wire type is what every module,
  every test and the descriptor ABI is written in. This was never Vital against Surge; it was
  hand-written DSP against library DSP.
- **simde is a new hard dependency**, because sst is hand-coded SSE2 and we build arm64. The first
  thing done for this change was proving that combination compiles and makes sound.
- **The probe found more than the reverb.** Run across the new rack it reported dead knobs on the
  phaser, the rotary speaker, both delays and Reverb 1 — every one of them an example whose
  parameters left the effect doing nothing, a phaser with Depth at 0 hiding Rate, Waveform and Stereo
  exactly as completely as a sustained tone hid the reverb. Those examples are fixed, and the fixing
  is the point: an example is what a person clicks, so an example that does not demonstrate its
  module is a bug in the module's surface.
- **Treemonster is deferred, and so is Nimbus.** Treemonster's pitch detector does not fire under our
  config — Threshold, Speed and both filter controls measure dead at every setting — and shipping it
  would be the exact thing this record exists to stop. Nimbus needs Surge's vendored `eurorack`.
- **`throughExample` builds a gated chain**: a pattern, a converter, an oscillator, an envelope, the
  voices summed, the effect, and out to both channels. Every effect example changed with it.
- **The old tests went with the old reverb.** `test_fx_reverb.cpp` is replaced by
  `test_sst_effects.cpp`, whose sharpest test compares each generated `ParamDesc` against what the
  effect itself would display. `test_vital_effects.cpp` keeps only what is still Vital's.
- **0009's measurements stand as a record of a reverb that no longer exists.** Keeping it readable is
  the point of not editing records: the reasoning was sound and the result was still wrong, and the
  reason is written above.

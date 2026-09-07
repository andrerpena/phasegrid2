# Amendment: Vital-native engine core

Amends `2026-09-07-phasegrid2-architecture-design.md`. Where the two disagree, this document wins. Everything not mentioned here (IPC, protocol, frontend, extensibility seams, project folder, phases 4–12) is unchanged.

## Why

The owner located the source of Vital (Matt Tytel's wavetable synthesizer, GPL-3.0-or-later, upstream `https://github.com/mtytel/vital`, frozen at commit `636ca0e`, 2022-04-20). Its wavetable oscillator, filters, effects and modulators are of a quality we cannot expect to reproduce in reasonable time. Its engine is essentially JUCE-free, so it can be vendored into a JUCE-less C++20 engine. Its graph and voice architecture, however, do not fit a Grid (one-block feedback, graph edits that allocate on the audio thread, whole-subgraph voice clones), so only the DSP and the SIMD signal type are adopted; phasegrid2's graph compiler, per-sample feedback clusters and atomic hot-swap remain as specified.

## Licensing and naming

- Vendored code is GPL-3.0-or-later; phasegrid2 remains AGPL-3.0-only (GPLv3 §13 permits the combination). Every vendored file keeps its copyright header. `engine/vendor/vital/NOTICE.md` records upstream URL, commit, license, and every modified file.
- The names "Vital", "Vital Audio", "Tytel", "Matt Tytel" never appear in module ids, UI strings, binaries or marketing. They appear only in `engine/vendor/vital/` and `NOTICE.md`. A lint step greps `engine/src`, `shared`, `src` for `vital` (case-insensitive).
- Vital's factory presets and wavetables are not redistributed. phasegrid2 generates its own default wavetables at startup.
- No build connects to vital.audio services; the vendored subset excludes authentication and Firebase entirely.

## Signal model (replaces "Channels / oversampling" and parts of "Signal model")

- The wire signal is `vital::poly_float`, aliased `pg::Sample`: four float lanes `[voice0.L, voice0.R, voice1.L, voice1.R]`, SSE2 on x86-64, NEON on arm64. Every continuous port carries `Sample[numFrames]`. There is no channel count on ports; stereo is everywhere, as in Bitwig. Mono sources write L = R.
- Event ports are unchanged (`Event`, `EventBuffer`, k-way merge by frame).
- `kMaxBlockSize = 128` (Vital's `kMaxBufferSize`); default engine block 64.
- Any output still connects to any input; fan-in is a lane-wise sum.
- Conventions (pitch 0.1/octave from middle C, gate > 0, phase 0..1) are unchanged. Where a Vital processor expects a MIDI note number the adapter converts `note = 60 + pitch * 120` per sample.

## Polyphony (replaces "Voices")

- Voices are processed in **pairs**: one lane group holds two voices. `voiceCount` rounds up to an even number; `Program.voicePairs = ceil(voiceCount / 2)`. Each pair has an `activeVoiceMask` (`poly_mask`) that terminals apply before summing, so unused voice lanes never reach the output.
- v1 runs one pair with voice 1 masked off. Polyphony later means the scheduler loops pairs and `note.toCv` distributes notes across lanes; the module API does not change.
- Module state is per instance; per-voice state lives in the lanes (Vital's own convention).

## Parameters

- `ParamDesc` / `ModuleDescriptor` remain C-layout. `ParamView` becomes `{ const Sample* buf; Sample k; Sample at(i) }`; the `FillParam` op computes `denormalize(clamp(rampNorm + mod[i]))` lane-wise, so modulation is per voice and per channel.
- Vital-backed modules expose one phasegrid param per Vital control. Descriptors are generated at registry time from `vital::Parameters::getDetails(prefix_control)`: min, max, default, display name, display units, `kIndexed` + `string_lookup` → enum. Modulatable = the control has a poly modulation destination.
- Semantics for Vital-backed params: the knob value goes to the Vital `Value`; the modulation the module receives on its own poly-mod destination is `(effective − knob)` per sample, so "knob + signal, clamped" holds for every module.

## Triggers

A continuous gate feeding a Vital reset/trigger input produces Vital trigger events at the exact sample: rising edge → `kVoiceOn` (with the note where applicable), falling edge → `kVoiceOff`, per lane. This keeps "any out to any in": envelopes and oscillators are (re)triggered by any gate-shaped signal.

## DSP sources (replaces "DSP primitives")

- DaisySP is removed. Vital DSP is vendored under `engine/vendor/vital/` as static library `vital_dsp`, compiled with warnings off, `-DNO_AUTH=1`, SSE2 or NEON per target, linking Accelerate on Apple (vDSP FFT) and kissfft elsewhere.
- JUCE is replaced by `engine/vendor/vital/shim/JuceHeader.h` (leak-detector macros as no-ops; minimal `String`, `MemoryOutputStream`, `Base64`; `ProjectInfo::versionString = "phasegrid2"`) and `shim/json/json.h` (forwarding to nlohmann/json). Vendored sources are not edited unless unavoidable; edits are listed in `NOTICE.md`.
- Vendored subset: `src/synthesis/{framework,filters,effects,modulators,producers,lookups,utilities,modules}` (minus voice handler, producers/filters aggregate modules, reorderable chain, modulation connection processor), `src/common/{synth_constants.h, synth_types.h, synth_parameters.*, synth_strings.h, fourier_transform.h, line_generator.*, wavetable/*}`, `third_party/kissfft`.

## The adapter

One adapter (`engine/src/vital/VitalModule`) wraps a `vital::SynthModule` subclass as a phasegrid `Module`, at Vital's **module level** (`FilterModule`, `OscillatorModule`, `EnvelopeModule`, `LfoModule`, `RandomLfoModule`, `SampleModule`, `ReverbModule`, `DelayModule`, `ChorusModule`, `FlangerModule`, `PhaserModule`, `DistortionModule`, `CompressorModule`, `EqualizerModule`). The module layer owns parameter scaling, model switching, mix/on handling, smoothing and per-parameter poly-modulation destinations, and is JUCE-free.

- `prepare()` (message thread): construct the Vital module, `init()`, `setSampleRate`, create one `vital::Output` per mapped input and one `modIn` Output per modulatable control, `plug` them (into inputs and `getPolyModulationDestination(name)`), set the modulation switches on.
- `process()` (audio thread, allocation-free): point each adapter `Output::buffer` at our block (zero copy), derive triggers from gate inputs, convert pitch inputs to MIDI notes into scratch, `set()` knob `Value`s that changed, fill `modIn` buffers, run `module->process(n)`, point the module's outputs at our output blocks.
- The first task of the revised plan is a spike that constructs `vital::FilterModule("filter_1")` standalone and filters a poly sine. If a `SynthModule` cannot stand alone, the fallback is wrapping raw processors (`DigitalSvf`, `SynthOscillator`, …) with hand-written port maps and our own scaling.

## Milestone 1 module set (replaces the M1 table)

Own modules: `phase.clock`, `math.scaleOffset`, `mix.mixer`, `amp.vca`, `io.audioOut`, `io.midiIn`, `note.toCv`, `display.scope`, `display.meter`.

Vital-backed modules: `osc.wavetable`, `filter.multi` (model enum: analog, dirty, ladder, digital, diode, formant, comb, phaser), `env.dahdsr`, `mod.lfo` (drawable `LineGenerator` shape), `mod.random`, `sampler.player`, `fx.reverb`, `fx.delay`, `fx.chorus`, `fx.flanger`, `fx.phaser`, `fx.distortion`, `fx.compressor`, `fx.eq`.

## Wavetables and samples (extends seam E.4 "Assets")

- `osc.wavetable` owns a `vital::Wavetable`; a `WavetableBank` service (message thread) renders builtins from `PredefinedWaveFrames` (sine, saturated sine, triangle, square, pulse, saw) and a basic morphing table, and loads `.vitaltable` JSON via `WavetableCreator::jsonToState` from the project `assets/wavetables/` folder. Swapping a table into a running oscillator uses Vital's `markUsed`/`markUnused` handshake.
- `sampler.player` wraps `SampleModule`; WAV files are decoded with miniaudio into `Sample::loadSample`.
- `module.setAsset {module, asset, path}` (spec §E.4) is the protocol command for both.

## Oversampling

Vital modules run at 1× in milestone 1. The per-module opt-in helper from the spec is later realised with Vital's `Upsampler`/`Decimator`.

## Plan impact

Foundation plan Tasks 1–5 are unchanged (Tasks 1–3 done; Task 3 has a pending fix round). Tasks 6–15 are rewritten around `Sample`; a new Task 6 vendors Vital and runs the standalone spike. Phase 3 ("14 modules on DaisySP") becomes the `vital-modules` plan, written once the spike has confirmed the wrapping level.

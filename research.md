Building a Bitwig-Grid-Style Generative DAW: C++ Libraries, Build-vs-Borrow, and Architecture
TL;DR
Adopt, don't reinvent, the DSP primitives: use permissive libraries (DaisySP/MIT, Mutable Instruments STM32 code/MIT, chowdsp_wdf/BSD, signalsmith-dsp/MIT, Cmajor stdlib/ISC) for oscillators, filters, and effects, and treat GPL sources (Surge's sst-*, Vital, VCV modules) as references — but the modular graph engine, the unified ±1 signal system, polyphonic graph evaluation, hot-swapping, sample-accurate modulation, IPC, and the UI are essentially not in any library and must be built yourself.
Your biggest licensing fork in the road is JUCE + Tracktion Engine: JUCE 8 is AGPLv3-or-commercial (per JUCE's own LICENSE.md: "dual-licensed under the AGPLv3 and the commercial JUCE licence") and Tracktion Engine is GPL3-or-commercial and licensed separately; combined with any GPL DSP (Surge sst, KFR, VCV) this forces your whole product open unless you buy commercial licenses. A commercially shippable stack is achievable but requires deliberate library selection.
Architecture: mirror Bitwig — run the C++ audio engine as a separate process from the Electron/Pixi.js UI, communicate via shared-memory ring buffers + a lock-free command queue, and keep the audio thread allocation-free. A native N-API addon is simpler to start but couples crashes and GC pauses to your audio engine; the separate-process model is the correct long-term choice.
Key Findings
The Grid is a unified-signal, oversampled, stereo, polyphonic modular environment. Bitwig's official Grid page states "The Grid offers some 230+ modules (and counting)," and the Grid Modules userguide lists exact per-category counts — I/O (27), Display (8), Phase (18), Data (13), Oscillator (12), plus Random, LFO and more. Sound On Sound's Bitwig Studio 3 review confirms verbatim that "all signal processing is 4x oversampled and conducted in stereo, including control, gate and phase signals," and Bitwig's userguide adds that "all signals within The Grid also operate at four-times (400%) your configured sample rate." Crucially, SOS notes "there's no facility in The Grid for direct MIDI processing" — everything is continuous CV/gate/phase. Bitwig also emphasizes the unified type system: "In The Grid, all signals are interchangeable so any out port can be connected to any in port. While this is rarely the case in other programs, Bitwig Studio has made it so." This unified signal model and per-voice polyphonic evaluation are the defining architectural features you must replicate, and they are exactly the parts no library gives you.
The best permissive DSP starting points are DaisySP (MIT), the Mutable Instruments STM32 code (MIT), chowdsp_wdf (BSD-3), signalsmith-dsp (MIT), and the Cmajor standard library (ISC). These can go straight into a closed-source or commercial product.
The highest-quality, most Grid-relevant DSP is GPL: Surge's sst-* libraries (sst-basic-blocks, sst-filters, sst-effects are GPL3), Vital/Vitalium (GPL3), and VCV Rack modules (GPL3). These are superb references but will infect a closed product.
JUCE's AudioProcessorGraph cannot do what The Grid does: it is block-level only and does not support feedback connections. JUCE forum maintainers confirm "it still doesn't support (or handle) feedback connections," and another thread notes "the AudioProcessorGraph stops rendering (the bus connections) if you have any feedback loops." It is therefore unsuitable as your modular engine core — you need a custom graph.
Tracktion Engine is a timeline/DAW engine, not a modular-synth engine. It's worth it only if/when you want arrangement, clips, transport, and plugin hosting — not for building the Grid itself.
JUCE 8's WebView UI and projects like Elementary Audio prove the web-UI-over-native-audio pattern works, but for a separate-process Electron app you'll build your own IPC rather than use JUCE's in-process WebBrowserComponent bridge.
Details
1. Landscape of public C++ DSP / modular libraries (2026)
Library	Provides	License	JUCE dep?	Maturity / maintenance	Wrap-as-module fit
JUCE juce::dsp	Oscillators, ladder/SVF filters, FIR/IIR, convolution, oversampling, FFT, delay lines	AGPLv3 / commercial	Is JUCE	Very mature; JUCE 8.0.x, active	Good building blocks; block-oriented
Tracktion Engine	Timeline, clips, plugin hosting, automation, tempo/transport, rendering, "Rack" patching	GPL3 / commercial (separate from JUCE)	Yes (JUCE module)	Mature, active; requires C++20	DAW layer, not modular core
Surge sst-basic-blocks	Block ops, param smoothing, LFO, oscillator utils, resamplers	GPL3 (a few headers MIT: LanczosResampler, HilbertTransform)	No (SSE2/SIMD)	Very active (2026 commits)	Excellent, but GPL
sst-filters	Surge filter models (SVF, vintage ladders, etc.), header-only	GPL3	No	Active	Excellent reference; GPL
sst-effects	Reverbs, delays, distortion, chorus	GPL3	No	Active	Excellent; GPL
sst-voicemanager	Polyphonic voice allocation, MPE, stealing strategies	(SST/MIT-family — verify)	No	Early-stage ("ultra-early draft")	Directly relevant to poly; immature
sst-jucegui	JUCE GUI widgets for SST synths	MIT	Yes	Active	UI only
chowdsp_utils	DSP (delay, pitch shift, filters, WDF, resampling, sources, SIMD), GUI, plugin utils	GPLv3 (per repo)	Yes (JUCE modules)	Active (commits into 2026)	Great, but GPL and JUCE-coupled
chowdsp_wdf	Wave Digital Filter circuit modeling, header-only	BSD-3-Clause	No	Active	Permissive; great for analog-modeled filters
DaisySP (Electrosmith)	Oscillators, filters, envelopes, effects, physical modeling, sampling	MIT	No	Active; widely used	Excellent permissive base; float, clean API
DaisySP-LGPL	Csound-derived modules	LGPL-2.1	No	Active	Permissive-ish (LGPL)
Mutable Instruments eurorack	Plaits, Braids, Rings, Clouds, Tides, Marbles, Grids, Elements, etc.	STM32 projects MIT; AVR projects GPL3; HW CC-BY-SA	No	Canonical repo, dormant since ~2022	World-class algorithms; MIT for STM32; needs de-embedding
stmlib	Fixed-point DSP helpers, PRNG, utilities (MI dependency)	MIT	No	Dormant	Needed to port MI code
VCV Rack SDK / rack::dsp	Modular framework, DSP helpers (filters, minBLEP, resamplers)	GPLv3 + non-commercial plugin exception + commercial	No	Very active	GPL; strong reference for modular idioms
Audible Instruments (VCV)	Official VCV ports of MI modules (Braids, Rings, Clouds, Tides, Branches, etc.; not Grids/Marbles)	GPL-3.0-or-later	VCV SDK	Active (Rack v2)	Float ports of MI; GPL
Gamma (Lance Putnam)	Generic synthesis (oscillators, filters, envelopes, spectral)	(permissive — MIT-family, verify)	No	Older but stable	Good for building blocks
STK (Synthesis ToolKit)	Physical modeling, classic synthesis, effects	STK license (permissive, MIT-like)	No	Long-standing, stable	Good, older idioms
Q (cycfi)	Header-only DSP, notable pitch detection	MIT	No	Active; C++20	Permissive, elegant; smaller scope
signalsmith-dsp (Geraint Luff)	Delays, envelopes, filters, FFT, curves (stretch is a separate lib)	MIT	No	Active	Excellent permissive utilities
KFR	FFT, FIR/IIR, filter design, resampling, SIMD tensors	GPL2+/commercial	No	Very active (2026); v6.1.1	High perf; GPL/commercial split
Faust / libfaust	DSP DSL → C++/LLVM/WASM; huge stdlib incl. physical modeling	LGPL (compiler); generated code owned by you	Optional (faust2juce)	Very active (GRAME)	Great for generating modules; JIT via libfaust
Cmajor	JIT DSP language; exports dependency-free C++ and JUCE projects	ISC (stdlib); commercial tooling options	Optional	Active (Sound Stacks)	Hot-reload DSP; ISC stdlib is permissive
Vital / Vitalium	Wavetable synth engine, modulation, effects	GPLv3 (commercial via licensing@vital.audio)	Yes	Source published on delay	Superb reference; GPL
Elementary Audio	Declarative JS + native C++ engine (elem::Runtime), custom nodes	Open source, permissive (v2.0, MIT-family)	No (has JUCE demo)	Active	Notable web-UI+native pattern; reconciling graph
libsamplerate / r8brain	Sample-rate conversion	libsamplerate BSD-2; r8brain MIT	No	Stable	Permissive resampling

Notes on maturity/uncertainty: sst-voicemanager self-describes as an "ultra-early voice manager draft," 
GitHub
 so treat it as a reference rather than a dependency. Gamma and STK licenses are permissive but should be verified against their current repos. chowdsp_utils license is reported as GPLv3 in the repo 
github
 but is sometimes tagged "other/Non-SPDX" by scanners — verify per module; chowdsp_wdf and chowdsp_fft are separately BSD-3.

2. Build-vs-borrow map by Grid module category
Grid category	Best library coverage	What you must build
Audio oscillators (band-limited)	DaisySP (MIT), MI Plaits/Braids (MIT), sst-basic-blocks (GPL), Vital (GPL ref)	Your ±1 unified-signal wrapper; phase-input FM; 4× oversampled anti-aliasing policy
Wavetable / sample oscillators	Vital engine (GPL ref), Surge wavetable (GPL ref), DaisySP	Wavetable format, loading, interpolation, mip-mapping; sampler streaming
Filters	sst-filters (GPL), chowdsp_wdf (BSD), DaisySP (MIT), juce::dsp	Per-voice state management, CV-rate cutoff modulation, oversampling
Envelopes / LFOs / modulators	DaisySP (MIT), sst-basic-blocks LFO (GPL), MI Stages/Tides (MIT)	Phase-driven envelopes; unified-signal modulation routing
Mixers / gates / VCA	Trivial; any lib	Just build — arithmetic on your signal type
Delay / reverb / distortion	sst-effects (GPL), signalsmith-dsp (MIT), chowdsp (BSD/GPL), DaisySP (MIT)	Feedback with one-sample-delay handling in the graph
Math / logic / comparators	None needed	Build — trivial per-sample ops on ±1 signals
Phase / clock signals (Bitwig phasors)	None (Bitwig-specific concept)	Build entirely — phase generators, Ø scalers, wrap logic
Step / data sequencers	VCV modules (GPL ref), MI Grids (GPL ref)	Build — phase-indexed lookup tables (Bitwig "Data" modules)
Note/pitch/gate/trigger utilities	sst-voicemanager (ref), MI code	Build — pitch/quantize/gate conversion in unified signal
Audio/Note/CV/modulation I/O modules	None (host-specific)	Build entirely — terminal nodes bridging engine I/O
Polyphonic voice allocation	sst-voicemanager (early), Yarns-style algorithms (MI)	Build — poly-aware graph cloning/evaluation, stealing
MPE handling	JUCE MPE classes, sst-voicemanager	Build routing of per-note expression into per-voice modulation
Sample-accurate modulation	CLAP concepts, Cmajor	Build — event timestamping through the graph
Oversampling / anti-aliasing	juce::dsp Oversampling, signalsmith, r8brain (MIT)	Build the 4×-everywhere policy and PolyBLEP/MinBLEP in oscillators
Generative: Euclidean, probability, Markov, clock div, quantizers	MI Marbles (MIT), brianhouse/bjorklund (MIT algo), VCV Bogaudio/Grande/Aria (GPL refs)	Build most from scratch (they're simple); Bjorklund/quantizer/Markov are ~dozens of lines

What is realistically in no library and must be custom:

The graph engine/scheduler: topological sort, feedback detection and one-sample-delay insertion, block vs. per-sample processing modes.
The unified ±1 signal type system (Bitwig's audio/CV/phase/trigger unification, stereo throughout; recall Bitwig's own claim that "any out port can be connected to any in port").
Polyphony-aware graph evaluation (per-voice subgraph instantiation and modulation).
Module hot-swapping while audio runs — Bitwig's userguide (Ch. 17) explicitly celebrates this: "Having sound never stop — even as modules are added and deleted — is joyful." This is a hard real-time engineering requirement, not a nicety.
Parameter smoothing, preset/patch serialization, undo.
The IPC protocol and the entire UI.
3. Architecture: Electron + Pixi.js ↔ C++ backend

Two models:

Native Node addon (N-API / node-addon-api): The audio engine is a .node library loaded into Electron's main (or a utility) process. Simplest to prototype and lowest-latency for control messages. Downsides: the audio engine shares a process with V8, so a Node/Electron crash or a GC pause can disrupt audio, and a DSP crash takes down your UI — the opposite of Bitwig's crash-isolation philosophy. Real-time audio threads created inside the addon must never touch the V8/JS heap.
Separate audio-engine process + IPC (recommended, mirrors Bitwig): A standalone C++ executable owns the real-time audio device and DSP graph; Electron is a pure client. This gives crash isolation (engine can survive UI reload; UI can restart engine), and later, plugin-sandbox isolation. This is the model Bitwig uses (Java UI, C++ engine, separate processes) and is the correct long-term architecture.

Transport choices (separate-process):

Control/commands (UI → engine): a local socket — Unix domain socket / named pipe, or WebSocket if you want the browser layer to speak it directly. Serialize with FlatBuffers or Cap'n Proto (zero-copy, schema-evolvable) in preference to protobuf for hot paths; JSON is fine for low-rate config.
High-rate telemetry (engine → UI: meters, scopes, waveforms): a shared-memory ring buffer the UI polls at frame rate (e.g., 30–60 Hz), decoupled from the audio block rate. Never push every sample over a socket; downsample/decimate scope data in the engine.
Crossing into the audio thread: never block. Use a lock-free SPSC/MPSC queue — moodycamel::ConcurrentQueue (or its SPSC ReaderWriterQueue), farbot (Fabian Renn-Giles' RT-safe FIFO/wrappers), crill, or JUCE AbstractFifo — to hand parameter changes and graph edits from the message thread to the audio callback. Do allocation, file I/O, and locking on non-RT threads only.

RT-safety rules for the audio thread: no malloc/free, no locks, no exceptions across the boundary, no logging, no JS. Pre-allocate voice pools and buffers; apply graph edits by swapping pre-built structures in via the lock-free queue with one-sample-accurate application.

Prior art for web-UI + native audio: JUCE 8's WebBrowserComponent/WebView UI (native C↔JS functions, resource provider, withNativeFunction/withEventListener) shows the in-process pattern; community helpers like tomduncalf_juce_web_ui and the JanWilczek WebView tutorial are working examples. Elementary Audio (elem::Runtime, embeddable next to a JS engine via CHOC's QuickJS) is the closest architectural analog to what you're building and open-sources its reconciling graph engine. Cmajor hosts a JIT engine with WebAudio/HTML export. These validate the pattern; for a separate-process Electron app you'll implement the IPC yourself rather than use JUCE's in-process bridge.

4. Tracktion Engine specifically

Tracktion Engine is dual GPL3-or-later / commercial, licensed and priced separately from JUCE 
GitHub
 (you need both licenses to ship a closed product), and requires C++20. 
GitHub
 It provides timeline, clips, tempo/key/time-signature curves, time-stretch/pitch-shift, MIDI (with MPE and pattern generation), plugin hosting for all major formats, automation with algorithmic modifiers, modular plugin patching "Racks," recording/comping, control surfaces, and rendering. 
Synthtopia

Verdict: Tracktion Engine is not the right tool to build The Grid itself — its "Rack" is a plugin-patching graph at the plugin/block level, not a sample-accurate modular synthesis environment with unified ±1 signals and per-sample feedback. It is worth adopting later if you want a full DAW around your Grid device: arrangement timeline, clip launching, transport/tempo sync, and external plugin hosting. Treat it as an optional outer shell, not the synthesis core.

JUCE AudioProcessorGraph limitations: it is block-level only and does not support feedback connections — confirmed by JUCE forum maintainers ("it still doesn't support (or handle) feedback connections") and users ("the AudioProcessorGraph stops rendering… if you have any feedback loops"). This makes it unusable for a Grid-style engine where oscillator/filter feedback and one-sample delays are first-class. Alternatives: build your own graph (recommended), study Elementary's reconciling graph, or use VCV Rack's engine model (GPL) as a reference. Per-sample feedback requires either fully per-sample graph evaluation or explicit one-sample-delay nodes on feedback edges — you implement this.

5. Plugin hosting (VST3/CLAP/AU/LV2)
JUCE hosting: AudioPluginFormat/AudioPluginFormatManager host VST3/AU/LV2 (and VST2 with the legacy SDK). Under AGPLv3 this is free; commercial JUCE license needed for closed products. VST3 is GPLv3-or-Steinberg-license; AAX/VST2 need Steinberg/Avid agreements.
CLAP hosting: CLAP itself is MIT — per u-he/Bitwig's CLAP page, "CLAP is open source, released under the MIT license: No fees, memberships or proprietary license agreements are required before developing or distributing a CLAP capable host or plug-in, and the license never expires" (CLAP 1.0 was initiated by u-he and Bitwig). Direct CLAP hosting gives you polyphonic modulation and sample-accurate parameters that JUCE's hosting layer blurs away. 
GitHub
 Options: free-audio/clap-wrapper (MIT) 
GitHub
 and jatinchowdhury18/juce_clap_hosting (MIT, but "super-alpha" — a juce::AudioPluginFormat subclass). 
GitHub
 clap-juce-extensions (for making, not hosting, CLAP from JUCE) is available; JUCE 9 is slated to add official CLAP support. 
Cleveraudio
Licensing implication: CLAP is the cleanest path for a permissively-licensed product. VST3 hosting drags in Steinberg's GPL3/commercial terms; plan accordingly.
6. Licensing summary
Component	License	Forces your product open?
JUCE 8	AGPLv3 or commercial (tiered; perpetual & subscription; JUCE 4–8 holders get 30% off JUCE 9 perpetual upgrades)	Yes under AGPL; no with commercial license
Tracktion Engine	GPL3-or-later or commercial (separate from JUCE)	Yes under GPL; no with commercial license
Surge sst-basic-blocks / sst-filters / sst-effects	GPL3 (few sst-basic-blocks headers also MIT)	Yes
sst-jucegui / sst-plugininfra	MIT	No
Mutable Instruments (STM32 modules: Plaits, Marbles, Rings, Clouds, Tides, Elements)	MIT	No
Mutable Instruments (AVR modules, incl. Grids likely)	GPL3	Yes
stmlib	MIT	No
VCV Rack SDK / modules	GPLv3 (+ non-commercial plugin exception; commercial available)	Yes (for combined works)
DaisySP	MIT	No
chowdsp_wdf / chowdsp_fft	BSD-3-Clause	No
chowdsp_utils	GPLv3 (verify per module)	Yes
signalsmith-dsp	MIT	No
Q (cycfi)	MIT	No
Faust	Compiler LGPL; generated code is yours	No (generated code)
Cmajor	stdlib ISC; exported C++ dependency-free	No
Vital / Vitalium	GPLv3 (commercial via licensing@vital.audio)	Yes
KFR	GPL2+ or commercial	Yes under GPL
CLAP / clap-wrapper / juce_clap_hosting	MIT	No
libsamplerate	BSD-2	No
r8brain	MIT	No

Two scenarios:

Open-source/experimental project (GPL3-friendly): Use everything. Build on JUCE (AGPL), optionally Tracktion Engine (GPL), Surge sst-*, VCV modules, Vital, KFR — the best DSP in the ecosystem is yours. Note: AGPL's network clause and app-store incompatibility (iOS) can bite even open projects.
Future commercial product: You will need commercial JUCE and commercial Tracktion Engine licenses (or avoid Tracktion). For DSP, stick to the permissive set — DaisySP, MI STM32 (MIT), chowdsp_wdf (BSD), signalsmith-dsp, Q, Cmajor/Faust-generated code, CLAP hosting, libsamplerate/r8brain — and re-implement any GPL algorithm (Surge, VCV, Vital, MI Grids) clean-room rather than copying, or buy a commercial license (KFR, Vital offer these). NYSTHI-style restrictively-licensed code (its license clashed even with the Cardinal project) should be avoided entirely, even as a dependency.
7. Recommended stack and phased build plan

Recommended stack (commercial-viable path):

Framework: JUCE (commercial license when you ship) for audio device I/O, MIDI, plugin hosting, and DSP utilities — or go leaner with RtAudio/miniaudio + your own DSP if you want to avoid JUCE entirely.
DSP primitives: DaisySP (MIT) + chowdsp_wdf (BSD) + signalsmith-dsp (MIT) + MI STM32 algorithms (MIT, de-embedded) + Cmajor/Faust-generated modules for rapid authoring.
Voice management: build your own, studying sst-voicemanager and MI Yarns algorithms.
Plugin hosting: CLAP first (MIT, best fidelity), VST3/AU via JUCE.
Concurrency: moodycamel + farbot/crill + JUCE AbstractFifo.
IPC/serialization: FlatBuffers or Cap'n Proto over Unix socket/named pipe + shared-memory ring for telemetry.
UI: Electron + Pixi.js, separate process.

Project structure (CMake, submodules):

/engine        (C++ audio engine executable)
  /graph       (your scheduler, signal type, voice mgr)
  /modules     (oscillators, filters, ... as graph nodes)
  /ipc         (schemas, shared-mem, socket server)
  /dsp         (vendored libs as submodules: daisysp, chowdsp_wdf, signalsmith, stmlib)
/ui            (Electron + Pixi.js)
/shared        (FlatBuffers/Capn schemas)
/tests         (Catch2 DSP null/spectral tests)
CMakeLists.txt (JUCE as submodule if used)

Use CMake with dependencies as git submodules (JUCE, DSP libs) or CPM; keep JUCE and Tracktion as clearly-isolated modules so you can swap or license them independently.

Phased plan:

Engine skeleton: audio device I/O, a single hardcoded oscillator→output graph, RT-safe callback. Prove no-xrun audio.
Signal type + graph engine: implement the unified ±1 stereo signal, topological sort, block processing, then per-sample mode and feedback/one-sample-delay handling. This is the crux — invest human DSP expertise here.
Core modules: oscillators (with PolyBLEP anti-aliasing + optional oversampling), filters, envelopes, LFOs, math/logic, mixers/VCAs. Borrow DSP from DaisySP/chowdsp; write the node wrappers.
Polyphony + modulation: per-voice subgraph instantiation, voice allocation/stealing, MPE, sample-accurate parameter events.
Phase/clock + sequencing + generative: build Bitwig-style phasors, data sequencers, quantizers, Euclidean (Bjorklund), probability/Bernoulli, Markov, clock dividers — mostly from scratch (each is small).
IPC + UI: patch editor in Pixi.js, telemetry (scopes/meters) over shared memory, preset serialization, undo.
Hot-swap + plugin hosting: module hot-swapping while audio runs; CLAP then VST3/AU hosting.
Optional DAW shell: integrate Tracktion Engine for timeline/clips/transport if desired.

What to delegate to Claude Code vs. keep human:

Delegate to Claude Code: node-wrapper boilerplate around existing DSP classes; IPC schema and serialization glue; Electron/Pixi UI components; CMake plumbing; Catch2 test scaffolding; porting/de-embedding MI STM32 algorithms from fixed-point to float; implementing well-specified small algorithms (Bjorklund, quantizers, clock dividers, Markov).
Keep human (careful DSP design): the graph scheduler and feedback/one-sample-delay semantics; the unified signal and oversampling policy; anti-aliasing correctness (PolyBLEP/MinBLEP band-limiting); voice-stealing and per-voice modulation; RT-safety audits of the audio thread; any filter stability/numerical work.

Anti-aliasing strategy: use PolyBLEP for classic analog-style oscillators (cheap, good enough at moderate oversampling), MinBLEP where you need higher quality on hard-sync/discontinuities, and oversampling (Bitwig's Grid runs 4× everywhere, including control/gate/phase) as the global policy for nonlinear modules (waveshapers, FM). juce::dsp::Oversampling, signalsmith, or r8brain (MIT) handle the up/downsampling.

Testing DSP code: use Catch2; write null tests (process silence → expect silence; bypass → bit-identical), spectral tests (FFT the output of an oscillator, assert aliasing components are below a threshold — signalsmith documents this style), impulse/step responses for filters, and golden-file regression on preset renders.

Generative-music specifics (libraries mostly don't cover these — build them, they're small):

Euclidean rhythms: implement Björklund's algorithm; brianhouse/bjorklund (MIT) is the verified-correct reference (many other ports are subtly wrong, e.g. failing 5-in-13). emcconville/static-euclidean-rhythm (C, table-baked) is another option.
Quantizers: trivial to write; Aria's quantizer.hpp (CC-BY-SA) and Grande's Quant/QuantMT modules (GPL, dbgrande/GrandeModular) are references.
Probability / Bernoulli gates / random walks: MI Marbles (MIT, STM32) is the gold-standard source and is permissively licensed; MI Branches (Bernoulli gate) and Bogaudio's Walk/Walk2 (GPL, bogaudio/BogaudioModules) are float references.
Markov / random-walk melody: no strong permissive library; implement from a transition matrix + weighted RNG (VCV community modules like flawr/rack-markov-chain and Stochastic Telegraph's Drifter are references).
Clock dividers: trivial counters — build.
Drum-pattern / topographic sequencing: MI Grids (likely GPL as an AVR project — verify the file headers) and the Valley Topograph VCV port (GPL, ValleyAudio/ValleyRackFree) are references; re-implement for a commercial product.
Recommendations
Decide the license posture first, because it dictates the DSP stack. If you're building an open/experimental GPL3 project, use the best-in-class GPL code (Surge sst-*, Vital, VCV, KFR) freely. If you want the option to go commercial, commit now to the permissive set (DaisySP, MI-STM32/MIT, chowdsp_wdf, signalsmith, Q, Cmajor/Faust-generated, CLAP, libsamplerate/r8brain) and treat all GPL code as read-only reference. Retrofitting GPL removal later is expensive.
Build the graph engine and unified signal system yourself, first and carefully. This is the true core of a Grid clone and exists in no library. Do not try to bend JUCE's AudioProcessorGraph to it — it can't do feedback. Prototype per-sample evaluation, then optimize hot subgraphs to block processing.
Choose the separate-process architecture (C++ engine ↔ Electron) from the start, even if you begin with a simpler in-process addon for the first prototype. Design the IPC boundary (FlatBuffers/Cap'n Proto + shared-memory telemetry + lock-free command queue) early so the UI is never in the audio path.
Adopt CLAP hosting as the primary external-plugin path (MIT, sample-accurate, poly-mod), adding VST3/AU via JUCE later. This keeps your licensing clean and your fidelity high.
Use Claude Code aggressively for the ~70% that is glue (node wrappers, IPC, UI, tests, algorithm ports) but keep a human on the graph scheduler, anti-aliasing, and RT-safety. Enforce RT-safety with tests/CI (e.g., a no-allocations-on-audio-thread check).
Only add Tracktion Engine when you actually need a timeline/DAW shell — and budget for its commercial license separately from JUCE's.

Benchmarks / thresholds that change the plan:

If you need to ship commercially within a tight budget, drop JUCE+Tracktion in favor of a lean stack (miniaudio/RtAudio + permissive DSP + your own hosting) to avoid per-seat license fees.
If per-sample feedback performance becomes a bottleneck, move from global per-sample evaluation to block processing with explicit one-sample-delay nodes only on feedback edges.
If UI telemetry causes xruns or jank, ensure scope/meter data goes only through the shared-memory ring at frame rate, never through the command queue or a socket per block.
If a GPL dependency proves indispensable (e.g., a specific filter), either buy its commercial license (KFR, Vital) or clean-room re-implement.
Caveats
Licensing details can change and some are nuanced. JUCE 8 is AGPLv3 (not plain GPLv3) plus commercial tiers; verify current pricing and the exact AGPL network/app-store implications for your distribution model before committing. Tracktion Engine requires its own license in addition to JUCE.
chowdsp_utils license is reported as GPLv3 in the repository README but license scanners sometimes flag it "Non-SPDX/other"; the separate chowdsp_wdf and chowdsp_fft repos are BSD-3. Verify per-module before shipping.
Mutable Instruments' split license means module-by-module checking is required: STM32F projects (Plaits, Marbles, Rings, Clouds, Tides, Elements) are MIT; older AVR projects (Grids and some others) are GPL3. Confirm the license header of the specific files you use. MI's name/trademark should not be reused in derivatives, and the canonical pichenettes/eurorack repo has been dormant since ~2022 (stable but unmaintained).
sst-voicemanager is explicitly an early draft ("ultra-early voice manager draft") and its license should be confirmed against the repo; don't treat it as production-ready.
Gamma and STK licenses are permissive but were not re-verified against their current repos in this research — confirm before commercial use.
The Grid's exact internal implementation is proprietary; details like "4× oversampling, stereo everything, unified ±1 signal, any-out-to-any-in" come from Bitwig's public docs and reputable reviews (Sound on Sound), not from source, so your engine will be a behavioral clone, not a port.
N-API/Electron audio is viable for prototyping but has real RT-safety hazards (V8 GC, single-process crash coupling); the separate-process recommendation exists precisely to avoid these.
VST2/AAX require Steinberg/Avid agreements that are separate from everything above and are increasingly restricted; prefer VST3/CLAP/AU/LV2.
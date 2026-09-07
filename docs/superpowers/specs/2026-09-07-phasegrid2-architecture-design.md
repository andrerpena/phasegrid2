# phasegrid2 — Architecture and Milestone 1 Plan

## Context

phasegrid2 is a generative, grid-based modular music platform modeled on Bitwig's The Grid, but aimed at generative music rather than instrument building. It is AGPL3. The frontend is Electron + TypeScript + React 19 + Pixi.js v8 and literally copies the architectural systems of `/Users/andrepena/gitp/osmc` (Pixi main view, Zustand stores, dock/widget/modal system, theme, keybindings, commands, schema + property grid), replacing Tailwind with CSS Modules + CSS custom properties. The backend is a separate C++20 audio engine process. Target UX: `npm install phasegrid2 && npm run dev` spawns Electron, the user picks a project folder, and everything is serialized there.

The earlier `/Users/andrepena/gitp/daw` spike proved "Electron sidecar works" but chose Tracktion Engine as the core, which `research.md` rules out (no feedback, block-only, wrong abstraction). Nothing from its engine carries forward; its supervisor/preload skeleton does.

The overriding goal is getting the architecture right: a small, RT-safe engine core with a unified signal model, a descriptor-driven UI so adding a module is C++-only work, and explicit seams for MIDI, samples, Strudel, dynamic plugins and CLAP hosting.

## Decisions (settled with the owner)

| Area | Decision |
|---|---|
| Engine base | Lean C++20. miniaudio (device I/O, WAV enc/dec), libremidi (MIDI). No JUCE. Device I/O behind a swappable backend interface. |
| Signal model | All wire signals are continuous float buffers, any out to any in (audio/CV/gate/phase interchangeable, nominal ±1). A second port kind carries typed timestamped events (notes, MPE, pattern events). Terminal modules convert events to signals. |
| Channels / oversampling | Signals are N-channel (1 or 2 now, compile-time max). Oversampling is opt-in per module via a shared helper. |
| Polyphony | Per-voice module state from day one (no statics). Voice count is a patch setting; v1 runs 1 voice; poly is a later scheduler/compiler feature. |
| Param modulation | Every modulatable param gets an implicit continuous input port (`param:<id>`); effective = clamp(knob + signal). Depth via `math.scaleOffset`. |
| DSP primitives | DaisySP (MIT) wrapped for oscillators/SVF/ADSR/LFO; sst-* (GPL) added later. Hand-write phase/clock, math, mixer, VCA. |
| IPC | Separate engine process. Control: Unix socket / named pipe, NDJSON request/reply + events, zod on TS, glaze on C++ (nlohmann/json fallback). Telemetry: shared-memory ring read by an N-API addon. |
| Module API | Static C++ registry, C-layout `ModuleDescriptor`. Engine serves the catalog as JSON; UI is 100% descriptor-driven. dlopen plugins later on the same ABI. |
| Distribution | Build from source on `postinstall` via plain CMake (engine + addon in one tree). macOS first. |
| Document ownership | Frontend (Zustand) owns the patch; every edit becomes `PatchOp`s sent to the engine, which mirrors and hot-swaps. Project folder written by TS. |
| Frontend toolchain | React 19, electron-vite, Biome, Vitest, Storybook. CSS Modules + CSS vars. No Tailwind. Drop immer, atlaskit DnD, AI SDKs, TanStack Router. Keep Monaco for the JSON config editor. |
| Milestone 1 | Audible grid with hot-swap and persistence (details below). |

## Repository layout

```
phasegrid2/
  package.json  CMakeLists.txt  CMakePresets.json (dev/release/rtsan/asan)
  engine/
    CMakeLists.txt  cmake/Deps.cmake (FetchContent, pinned tags)  cmake/Warnings.cmake
    src/core/      Conventions.hpp Signal.hpp Event.hpp Ports.hpp Param.hpp Descriptor.hpp
                   Module.hpp Registry.{hpp,cpp} GraphModel.hpp GraphCompiler.{hpp,cpp}
                   Program.hpp Scheduler.{hpp,cpp} Engine.{hpp,cpp} ParamQueue.hpp Smoother.hpp Voice.hpp
    src/dsp/       Oversampler.hpp FastMath.hpp (thin wrappers over DaisySP live in modules/)
    src/modules/   one .cpp per module + builtin.cpp (explicit registration list)
    src/services/  AudioDevice.hpp MiniaudioBackend.cpp NullBackend.cpp MidiInput.hpp
                   LibremidiInput.cpp Transport.hpp Telemetry.{hpp,cpp} CommandServer.{hpp,cpp} Catalog.cpp
    src/protocol/  Messages.hpp Dispatch.cpp     src/rt/ RtAssert.hpp SpscQueue.hpp RetireQueue.hpp
    src/platform/  Shm.hpp LocalSocket.hpp       src/render/ OfflineRenderer.{hpp,cpp}
    src/app/main.cpp   --socket <path> --shm <name> | --render | --catalog | --tone
    tests/         Catch2 suites + util/{Fft.hpp,NewGuard.cpp} + golden/
  native/          N-API addon pg_telemetry.node (node-api-headers + node-addon-api), index.{js,d.ts}
  shared/protocol/ envelope.ts commands.ts events.ts catalog.ts patch.ts telemetry.ts version.ts
  shared/fixtures/catalog.json   (lets the frontend track start before the engine exists)
  src/main/ src/preload/ src/renderer/   (electron-vite layout, as OSMC)
  scripts/ build-native.mjs dev.mjs engine-cli.mjs check-no-tailwind.mjs
  docs/ architecture.md engine.md protocol.md adding-a-module.md design-system.md
```

Build: plain CMake (not cmake-js). The addon needs only Node-API headers from the `node-api-headers` / `node-addon-api` npm packages and is ABI-stable across Electron and Node (tests). FetchContent (not submodules) because an npm tarball has no `.git`. `scripts/build-native.mjs` runs on `postinstall` and before `dev`; skipped with `PHASEGRID_SKIP_NATIVE=1`; clear error if cmake/compiler missing. Engine binary lookup: `PHASEGRID_ENGINE_BIN` → `<repo>/build/engine/phasegrid-engine` → `process.resourcesPath/engine/`.

Scripts: `postinstall`, `dev`, `engine:build`, `engine:test`, `engine:render`, `engine:cli`, `typecheck`, `lint`, `lint:fix`, `test`, `storybook`, `build:mac`.

Third-party (M1): miniaudio, libremidi, glaze, moodycamel readerwriterqueue, Catch2 v3, DaisySP. Pre-declared behind options: sst-basic-blocks/sst-filters/sst-effects, signalsmith-dsp.

## Engine core

### Conventions (`core/Conventions.hpp`, also served in `hello`)
Float signals nominal ±1. Pitch: `freq = 261.6256 * 2^(v * 10)` (0.1 per octave), MIDI note n → `(n-60)/120`. Gate high when `> 0`, level = velocity. Phase 0..1 ramp. `kMaxBlockSize=256`, default block 64 (runtime), `kMaxChannels=2`, `kMaxEventsPerBlock=256`.

### Signals and events
```cpp
struct SignalView { float* const* ch; uint32_t numChannels, numFrames;
  const float* read(uint32_t c) const;   // mono broadcasts to stereo consumers
  float* write(uint32_t c); SignalView slice(uint32_t off, uint32_t n) const; };
enum class EventType : uint16_t { NoteOn=1, NoteOff, NotePressure, NoteExpression, Trigger /* 64..127 expression, 128+ user */ };
struct Event { uint32_t frame; EventType type; uint8_t channel, flags; uint32_t noteId; float a, b, c; }; // POD
struct EventBuffer { Event* events; uint32_t count, capacity; bool push(const Event&); void clear(); };
```
Fan-in: continuous = sum; event = k-way merge by frame. Both are compiler-emitted ops; modules never see fan-in.

### Descriptor, module, params
Descriptors are C-layout POD (no std::string/vector) with `abiVersion`, so they can cross a dlopen boundary later.
```cpp
enum class PortKind : uint8_t { Continuous, Event };
enum class SignalRole : uint8_t { Any, Audio, Cv, Gate, Pitch, Phase };    // UI hint only
struct PortDesc  { const char* id; const char* name; PortKind kind; uint8_t channels; SignalRole role; const char* doc; };
enum ParamFlags : uint32_t { kModulatable=1, kInteger=2, kEnum=4, kHidden=8, kNoSmooth=16 };
struct ParamDesc { const char* id; const char* name; float min, max, def; ParamUnit unit; ParamCurve curve; uint32_t flags;
                   const char* const* enumLabels; uint32_t enumCount; const char* uiWidget; const char* group; const char* doc; };
struct ModuleDescriptor { uint32_t abiVersion; const char* id; const char* name; const char* category; const char* doc;
  const PortDesc* inputs; uint32_t numInputs; const PortDesc* outputs; uint32_t numOutputs;
  const ParamDesc* params; uint32_t numParams; uint32_t flags /*kTerminal|kNeedsTransport|kWritesTelemetry*/;
  uint32_t telemetrySlots; Module* (*create)(); };

struct ProcessContext { uint32_t numFrames, voice; double sampleRate; const TransportSnapshot& transport;
  SignalView in(uint32_t); SignalView out(uint32_t); const EventBuffer& eventIn(uint32_t); EventBuffer& eventOut(uint32_t);
  ParamView param(uint32_t); TelemetrySlot* telemetry(uint32_t); AudioBus* outputBus; };
struct ParamView { const float* buf; float k; float at(uint32_t i) const { return buf ? buf[i] : k; } };
class Module { public: virtual void prepare(const PrepareInfo&) = 0;  // message thread, allocate here only
                       virtual void reset(uint32_t voice) {}
                       virtual void process(ProcessContext&) = 0; };    // audio thread: no alloc/lock/IO
template <class State> class VoicedModule : public Module { std::vector<State> states_; State& st(const ProcessContext& c); ... };
```
Registry derives the implicit `param:<id>` input port for every `kModulatable` param and validates ids/ranges at startup. Param state (target + smoother, ~5 ms ramp) lives on the instance, not per voice, and survives program swaps. Registration is an explicit list in `modules/builtin.cpp` (no static-init magic); CMake globs `modules/*.cpp`. Adding a module = one file + one line.

### Graph, compiler, Program
Engine-side `GraphModel` (message thread) mirrors the document. `compile()` produces an immutable `Program`:
```cpp
struct Op { enum Kind : uint8_t { SumContinuous, MergeEvents, FillParam, FeedbackRead, FeedbackWrite, Process, ClusterBegin, ClusterEnd, ClearEventBuf } kind; uint32_t a, b, c; };
struct Program { uint64_t revision; std::vector<NodeSlot> nodes; std::vector<PlanarBuffer> buffers; std::vector<EventBuffer> eventBufs;
                 std::vector<Op> ops; std::vector<std::shared_ptr<FeedbackState>> feedback; uint32_t voiceCount; };
```
Compile: resolve types → reuse/create instances → adjacency incl. implicit param ports → Tarjan SCC → condensation topo order → inside each non-trivial SCC pick deterministic order, mark back edges → emit ops.

Feedback: block processing for acyclic regions; **per-sample execution inside SCC clusters** with a true one-sample delay on back edges (`FeedbackRead`/`FeedbackWrite`). Modules are untouched (they accept `numFrames == 1`). Patch setting `feedbackMode: "sample" | "block"` (default sample); block mode makes the back edge a one-block delay as a cheap fallback.

### Hot-swap
Message thread compiles `Program* next` (all allocation there) → `pending_.store(next)`. Audio thread at block boundary: single `exchange`, pushes old program to an SPSC retire queue; message thread frees it. Instance reuse rule: same `(moduleId, typeId)` → same instance (state continuous); same back-edge id → same `FeedbackState`. Param changes bypass swap via an SPSC `ParamQueue` drained at block start. UI gestures batch ops (`patch.batch`) → one compile + swap per undo entry.

### Voices
`Program.voiceCount` sizes per-voice state at prepare. Scheduler already loops `for v in voices`. Later: compiler infers `PerVoice | Mono` domains per node; voice allocation lives in `services/VoiceAllocator` driven by `note.toCv`. v1 ships "last note, legato" behind the same interface. Module API does not change for poly.

### Services
- `AudioDeviceBackend`: `enumerate/open/close/onDeviceChange`; `MiniaudioBackend`, `NullBackend`. Device period ≠ engine block → splitter ring in `Engine::renderDevice`.
- `MidiInput` (libremidi): callback thread → SPSC → drained at block start into Events (v1 quantizes to block start).
- `Transport`: atomics `{tempo, playing, samplePos, ppq}` snapshotted per block; `phase.clock` derives from ppq.
- `Telemetry`: shm writer; modules with `kWritesTelemetry` get `TelemetrySlot*`; seqlock'd memcpy (RT-safe).
- `CommandServer`: one thread, NDJSON, glaze parse into typed structs, dispatch on the engine's single message thread; pushes events to all clients.
- `Catalog`: registry → JSON incl. conventions, implicit ports, `catalogHash`.

### RT-safety enforcement
Rules in `docs/engine.md`. `tests/util/NewGuard.cpp` overrides global new/delete with a thread-local RT scope; `test_rt_alloc` wraps scheduler, param drain, swap and every module's `process`. `PG_RT_NONBLOCKING` → `[[clang::nonblocking]]`; optional `rtsan` preset (Homebrew LLVM ≥ 20, not installed locally).

### Headless path and tests
`phasegrid-engine --render patch.json --seconds 2 --out out.wav [--sr] [--block] [--midi events.json]` via `NullBackend` + `OfflineRenderer`. Catch2: `test_graph`, `test_feedback` (y[n]=x[n-1] exactness), `test_hotswap` (bit-identical output after adding an unrelated node; filter continuity), `test_modules_null`, `test_spectral` (saw aliasing ≥ 60 dB down; SVF slope), `test_rt_alloc`, `test_protocol`, golden renders.

### M1 modules
| id | in | out | params (* modulatable) |
|---|---|---|---|
| `osc.sine` | pitch, fm | out | octave, semitones*, fine*, fmAmount* |
| `osc.saw` (DaisySP PolyBLEP) | pitch, fm, sync | out | octave, semitones*, fine*, fmAmount* |
| `filter.svf` (DaisySP Svf) | in, cutoff | out | cutoff*, resonance*, mode, drive* (2x OS opt-in) |
| `amp.vca` | in, gain | out | gain*, curve |
| `env.adsr` (DaisySP Adsr) | gate | out | attack*, decay*, sustain*, release*, retrigger |
| `mod.lfo` | rate, reset | out | rate*, shape, bipolar, phaseOffset* |
| `phase.clock` | (transport) | phase, trigger | division, swing* |
| `mix.mixer` | in1..in4 | out | level1..4* |
| `math.scaleOffset` | in | out | scale*, offset* |
| `io.audioOut` (terminal) | inL, inR | — | gain* |
| `io.midiIn` (terminal) | — | notes (event) | device, channel |
| `note.toCv` | notes (event) | pitch, gate, velocity | mode, glide* |
| `display.scope` (telemetry) | in | — | timebase, trigger |
| `display.meter` (telemetry) | in | — | — |

## Protocol and process topology

Envelope: `{"id",cmd,args}` → `{"id",ok:true,result}` | `{"id",ok:false,error:{code,message}}`; events `{"event",seq,data}`. `hello` returns `protocolVersion`, `engineVersion`, `catalogHash`, `conventions`, `shm:{name,size,layoutVersion}`, `capabilities`. Major version mismatch is refused. Unknown keys ignored on both sides.

TS side (`shared/protocol/commands.ts`): a typed command table `{ [name]: { args: zod, result: zod } }` giving `call<C>(cmd, args)` full inference.

Commands: `hello`, `catalog.get`, `patch.load`, `patch.clear`, `patch.batch {ops}`, `module.add`, `module.remove`, `edge.add`, `edge.remove`, `param.set {module,param,value,transient?}`, `patch.setVoiceCount`, `patch.setFeedbackMode`, `transport.play|stop|setTempo|seek`, `device.list|select`, `midi.list|select`, `telemetry.subscribe {modules} → {slots}`, `telemetry.unsubscribe`, `engine.ping|shutdown`.
Events: `engine.ready`, `engine.error`, `engine.log`, `device.changed`, `midi.devicesChanged`, `midi.noteFeedback`, `transport.position` (~20 Hz), `patch.revision`.

`PatchOp` (`shared/protocol/patch.ts`) is the single vocabulary shared by history, engine sync, batching and persistence: `moduleAdd | moduleRemove | edgeAdd | edgeRemove | paramSet | moduleMove (UI-only) | setVoiceCount`.

Shared memory (`shared/protocol/telemetry.ts` ↔ `services/Telemetry.hpp`): 64-byte header (magic `PGTL`, layoutVersion, slotCount, slotBytes=8 KiB, sampleRate, blockSize, heartbeat) + slots `{seq (seqlock), kind, channels, frames, blockIndex, payload}`; meter = peak/rms/clip per channel, scope = float[ch][1024]. `shm_open("/pg-<pid>")`; unlinked on exit and by the supervisor on restart. Module→slot map comes from `telemetry.subscribe`, never from shm.

Getting shm to the renderer: **preload loads `pg_telemetry.node`** (OSMC already runs `sandbox:false`, contextIsolation on) and exposes `window.telemetry.read(slot)` returning a copied `Float32Array`. Synchronous, no IPC hop, ~2 MB/s for four scopes. Fallback: main-process polling over IPC.

Supervisor (`src/main/engine/supervisor.ts`, evolve from `daw/src/main/index.ts`): spawn with `--socket <userData>/engine-<pid>.sock --shm /pg-<pid>`, forward stdio as logs, `socket-client.ts` (NDJSON over `net.connect`, pending map by id, reject-all on close), restart with exponential backoff (5 in 60 s → `engine.crashed`), emit `engine.connected {restarted}` so the reconciler resends the patch.

Preload API: `window.engine.call/onEvent`, `window.telemetry.open/read/close`, `window.project.pickFolder/readFile/writeFile/list/exists/watch`, `window.appStorage.read/write`. Typed via `src/preload/index.d.ts` importing `/shared`.

## Frontend

### Copy from OSMC (`/Users/andrepena/gitp/osmc/src/renderer/src`), whitelist
`commands/` (types, CommandRegistry, defineCommand, useCommand, definitions: runCommand, setTheme, undo/redo, widget.*), `keybindings/`, `config/`, `components/{dock,tabs,floating/modal,floating/toast,form,form-controls,command-palette,dropdown-menu,buttons,resize-handle,status-bars,widgets (shell)}`, `schemas/core/`, `history/`, `lib/{logger,log-store,color,viewport-simple}`, `hooks/useDebounced*`, `theming/` (types), `css/fonts.css`, `AppProviders.tsx`, `App.tsx`, `main.tsx`, `.storybook/`, `biome.json`, tsconfigs, `electron.vite.config.ts` (drop Tailwind/PostCSS, keep CSS modules camelCase + manualChunks).
Do not copy: `components/schema-form/` (read-only duplicate), `data-grid/`, `world/`, `tools/`, `structures/`, `goods/`, `simulation/`, `demos/`, `router/`, `services/storage/web-storage.ts`, `charts/`.

### CSS Modules and theme
- `css/tokens.css`: `--font-size-{caption,body,heading,display}` = 12/14/16/24, `--space-{1..4}` = 4/8/12/16, radii. `docs/design-system.md` rewritten for these vars (no inline static px).
- **JS theme is the single source.** `theming/theme.ts`: `PhasegridTheme { id, name, type, colors: UIColors (hex), grid: { background, gridLine, nodeFill, nodeStroke, nodeSelected, portContinuous, portEvent, portParam, cableContinuous, cableEvent, marquee } }`. `theming/apply-theme.ts` writes `--color-*` onto `documentElement.style` and sets `data-theme`. Pixi reads the same object via `useThemeStore` (`hexToNumber` from `lib/color.ts`). `css/theme.css` is deleted. User overrides stay in config key `theme`.
- Each component gets `X.module.css`; Tailwind utilities become token-based CSS. `scripts/check-no-tailwind.mjs` runs in `npm run lint`.
- Widget layout: replace `useWidgetLayoutStore` mirror with selectors over `useConfigStore` + actions calling `config.set`. No reverse subscription, no `JSON.stringify` compare.

### Keybinding scopes (new)
`Keybinding { key, command, args?, when? }`. `keybindings/context.ts` = `{ focus: "grid"|"propertyGrid"|"catalog"|"logs"|"none", modalOpen, hasSelection, engineReady }`, focus derived from `activeElement.closest("[data-kb-scope]")` via `useKeybindingScope(id)`. `keybindings/when.ts` = tiny evaluator (`==`, `!=`, `!`, `&&`, `||`). Scoped matches beat unscoped; ties → last registered. Modifier-chord swallowing kept except when focus is `propertyGrid`.

### New domains
- `catalog/catalog-store.ts`: `{ modules, byCategory, hash, status }` loaded on `engine.connected`, validated by `ModuleDescriptorSchema`. Fixture for Storybook/tests.
- `patch/patch-store.ts`: `{ id, name, voiceCount, feedbackMode, modules: Record<id,{id,type,x,y,label?,params,data?}>, edges }` + `applyOps(ops, {record, source})`. `patch/ops.ts`: `invert(ops, doc)`, `applyToDoc`. History entries are OSMC closures built from ops (`apply = applyOps(ops)`, `revert = applyOps(invert)`), so they are also serializable. Param drags: `beginGesture / setParamTransient / endGesture` → one entry.
- `patch/engine-sync.ts`: listens to the store's `opsApplied` emitter, drops UI-only ops, sends `patch.batch`; reconciler resends `patch.load` + telemetry subs + transport on `engine.connected {restarted:true}`. `EngineClient` interface with `MockEngineClient`.
- `grid/`: `GridView.tsx` (World.tsx clone: single effect, `cancelled` flag, ResizeObserver + ticker flush), copied `SimpleViewport`, renderer classes `{container, update(), destroy()}` subscribing to stores imperatively: `BackgroundRenderer`, `ModuleNodeRenderer` (from descriptors; inputs + implicit param jacks left, outputs right; implicit jacks shown on hover/connected), `CableRenderer` (cubic bezier, color by port kind, hit test by 24-segment sampling ≤ 6 px/zoom), `SelectionRenderer`, `DragCableRenderer`. `grid/layout.ts` pure `measureNode` (unit-tested). `grid/interaction.ts` state machine `idle → dragNodes | marquee | dragCable | pan`. `grid/snap.ts` (8 px). `selection/selection-store.ts` (module + edge ids).
- `inspector/descriptor-to-schema.ts`: params → `ObjectSchema` (`schema.number().withMetadata({label, unit, description, renderer:"slider", min, max, step, curve})`, enums → `enumValues`). Extend `SchemaMetadata` with `min/max/step/curve`; add `SliderFieldRenderer` to `components/form/field-renderers/renderer-factory.tsx` emitting gesture begin/end. Form re-keyed on selected module id.
- `telemetry/telemetry-store.ts`: `{ shmName, slotsByModule }`; opens reader on connect; subscribes for all `display.*` modules (debounced on patch change).
- `project/`: `project-store.ts` `{ rootPath, name, dirty, patches[] }`; `project-fs.ts` writes `project.json`, `patches/<id>.json` (`schemaVersion` + migration table), `.phasegrid/ui-state.json`. `services/storage/electron-config-storage.ts` implements OSMC's `ConfigStorageProvider` over `window.appStorage` (keybindings/layout/theme are app-level).

### Pixi surfaces and the piano roll (new)

**Pixi Applications are a budgeted resource.** Each one owns a WebGL context and browsers cap how many
may be live at once, so only full-view editors get one: the grid, and the piano roll. Small per-module
visualisations (`display.scope`, `display.meter`) draw with a 2D canvas, because a patch may hold dozens
and one Application each would exhaust the context budget. OSMC's `hooks/usePixiApp.ts` already creates
and destroys an Application per component, with a guard against the async-init race, so a second surface
needs no change to it.

**The piano roll is its own Pixi surface inside a modal**, not part of the grid. A `notes.clip` node opens
it, through the existing `widget.openInModal` command. `pianoRoll/` mirrors `grid/`: a `PianoRollView.tsx`
owning the Application, its own `SimpleViewport`, and renderer classes `{container, update(), destroy()}`
subscribing to stores imperatively — a background and beat grid, notes, a selection layer, a playhead fed
by transport telemetry, and a velocity lane.

**View state lives in a store, never in the Application.** The modal unmounts its children when it closes
(Headless UI's default) and `usePixiApp` destroys the Application with it, so scroll, zoom, grid division,
snap and note selection belong to `pianoRoll/piano-roll-store.ts`. Reopening the modal restores the view
the user left.

**Note edits are patch ops.** A clip's notes live in the owning node's `data`, so editing them goes through
`patch-store.applyOps` like every other change, and undo, redo and engine sync work unchanged. The engine
treats note data as structural and rebuilds the clip instance, which is free because the clip derives its
playhead from the transport.

**Input arbitration already exists.** `keybindings/context.ts` carries `modalOpen`, and OSMC's
`components/floating/modal/modalState.ts` exposes a subscribable store precisely so non-React code can stop
handling input while a modal is open. The grid's interaction state machine must observe it, so dragging in
the piano roll never moves a node behind it.

**Porting note.** OSMC's `Modal.tsx` is the most Tailwind-dependent component on the copy whitelist: size and
alignment maps plus `data-[closed]:` variants. Those become CSS Module classes with attribute selectors on
the same Headless UI state attributes. `@headlessui/react` is a new dependency introduced by this phase.

### Widgets and commands (M1)
Widgets: `grid` (center, pinned, wide, unscrollable), `inspector` (right-top), `catalog` (left-top, searchable tree, double-click adds), `scope` (right-bottom, scope + meters), `logs` (center-bottom), `settings` (left-bottom, Monaco JSON config), `history` (left-bottom). `transport` control bar in the Dock `top` slot (play/stop, tempo, device, engine status).
Commands: `workbench.runCommand`, `workbench.setTheme`, `project.new/open/save/saveAs`, `patch.addModule` (payloadSchema with catalog enum → auto form modal), `patch.deleteSelection`, `patch.duplicate`, `patch.connect/disconnect` (hidden), `patch.setParam` (hidden), `edit.undo/redo`, `transport.toggle/setTempo`, `engine.restart`, `view.zoomIn/zoomOut/zoomToFit/resetZoom`, `widget.openInModal/bringToFront/setActiveTab`.

## Extensibility seams (designed now, implemented later)
1. **Port kinds / event types**: `PortKindTraits` table in the compiler (buffer type, fan-in op); `EventType` reserved ranges; TS passes unknown types through.
2. **Dynamic plugins**: C-layout descriptors with `abiVersion`; `ModuleVTable { create, destroy, prepare, process, reset }` filled by `ModuleAdapter<T>` for builtins; later `Registry::loadPlugin(path)` + `extern "C" pg_get_modules()`; ids `plugin/module`.
3. **Script/Strudel**: engine module `io.eventIn` with a timestamped lookahead queue fed by `events.push {module, events:[{time:{samples|ppq},...}]}`; frontend `scripting/` runs the pattern engine in a Web Worker with ≥ 100 ms lookahead aligned to `transport.position`. Engine never runs JS.
4. **Assets**: descriptor `assets:[{id,kind}]`; `module.setAsset` loads into `SampleBank` on the message thread, atomic swap into the instance; project `assets/` folder.
5. **CLAP host**: `host.clap` returns an *instance descriptor* from `module.add`; UI keys node layout by `instanceDescriptor ?? catalog[type]`; engine process owns plugin GUI windows.
6. **Audio backends**: `device.list` returns `{backend,id,...}`; `NullBackend` ships in M1.
7. **Multiple patches**: `project.json.patches[]`; commands carry optional `patch` (default `main`); `Engine` holds `vector<PatchRuntime>` summed to the output bus.

## Phased implementation (Milestone 1)

Two tracks run in parallel after phase 0: **Engine** (1→2→3→4→5) and **Frontend** (6→7→8→9 against `MockEngineClient` + fixture catalog). Phase 4 is the join; 10–12 are integration.

| # | Phase | Deliverables | Verification |
|---|---|---|---|
| 0 | Scaffold | package.json, CMake (engine + addon stubs), presets, copied biome/tsconfig/electron-vite/vitest/storybook, `scripts/*.mjs`, GitHub Actions macOS job, `/shared` skeleton, docs stubs, AGPL LICENSE, CLAUDE.md | fresh clone: `npm install` builds both; `typecheck`, `lint`, `test`, `engine:test` green |
| 1 | Engine skeleton | `MiniaudioBackend`, `NullBackend`, block splitter, `--tone`, `NewGuard` + `test_rt_alloc`, `rtsan` preset | `--tone` audible 60 s no xruns; `ctest -R rt` |
| 2 | Core | Signal/Event/Descriptor/Module/Registry/GraphModel/Compiler/Program/Scheduler/swap+retire/ParamQueue+Smoother; `OfflineRenderer` + `--render`; test modules `test.gain`, `test.delay1` | `test_graph`, `test_feedback`, `test_hotswap`, `test_rt_alloc`; JSON patch → WAV |
| 3 | Modules + catalog | 14 modules on DaisySP, `Oversampler`, `--catalog`, golden patches | `test_modules_null`, `test_spectral`, goldens; `--catalog` validates against `shared/protocol/catalog.ts` in vitest |
| 4 | Protocol + supervisor | `CommandServer`, `Messages.hpp`, zod schemas, `supervisor.ts`, `socket-client.ts`, preload `window.engine`, `engine-cli.mjs` | `test_protocol`; CLI hello/catalog/module.add; `kill -9` → auto-restart + `engine.connected{restarted:true}` |
| 5 | Telemetry | shm writer, meter/scope slots, `native/` addon, preload `window.telemetry` | node script reads `--tone` meter via addon; vitest on header/seqlock fixture |
| 6 | Shell | OSMC copy per whitelist, CSS Modules + tokens, JS theme, layout-store fix, storage provider, empty widgets | Storybook renders Dock/Tabs/Modal/SchemaForm/Palette dark+light; `check-no-tailwind`; typecheck/lint |
| 7 | Patch + sync + undo | `patch-store`, `ops`, history, `engine-sync` + reconciler, `MockEngineClient`, patch/edit commands | vitest `invert(apply(ops))` identity, undo/redo, batch shape; with engine: revision increments |
| 8 | Grid editor | GridView, renderers, layout, interaction, cables, marquee, snap, zoom commands | vitest `measureNode`, hit-test, marquee; Storybook story; manual `midiIn→toCv→saw→svf→vca→audioOut` |
| 9 | Inspector | `descriptor-to-schema`, `SliderFieldRenderer`, gesture history, metadata extensions | vitest conversion; manual: drag cutoff, hear it, one undo entry |
| 10 | Scope/meter widgets | canvas drawing from `window.telemetry.read`, subscriptions | visual; vitest slot mapping/resubscribe |
| 11 | Project persistence | `project-fs`, `project.json`, `patches/*.json`, migrations, recent projects, path guard, `project.*` commands | vitest round trip + migration + traversal rejection; manual new/open/save/saveAs |
| 12 | Polish | hot-swap audit test (100 random edits, no discontinuity beyond smoothing), keybinding scopes + defaults, docs, `adding-a-module.md` validated by adding `math.abs` with zero TS changes | clean clone `npm install && npm run dev` demo; CI green |

## Risks and recommendations
1. glaze compile issues on Apple clang 17 → 1-hour spike in phase 4; nlohmann/json behind `protocol/Json.hpp`.
2. CoreAudio period vs block → splitter ring; request 128-frame periods.
3. Per-sample feedback CPU → bounded to SCCs; `feedbackMode: block` fallback; measure with a 10-node loop in phase 2.
4. N-API addon in preload under Electron 41 → verify first thing in phase 5; fallback main-process polling.
5. shm leaks after crashes → pid-named segments unlinked on start/exit and by the supervisor.
6. Instance reuse by `(id,type)` → type replacement resets state (acceptable). Disconnected inputs zero-fill so gates fall.
7. MIDI timing quantized to block start in v1 (≤ 1.3 ms at 64/48k); refine with libremidi timestamps later.
8. Implicit param jacks clutter → show on hover/connected only.
9. Storybook browser-mode vitest is heavy → `unit` project only in M1.
10. Params stay numeric; strings (script/asset paths) go through the assets concept, not params.

## Verification (end-to-end, after phase 12)
1. Fresh clone: `npm install` (builds engine + addon), `npm run typecheck && npm run lint && npm test && npm run engine:test`.
2. `npm run dev` → Electron opens, transport bar shows engine connected, catalog lists 14 modules.
3. Build `io.midiIn → note.toCv → osc.saw → filter.svf → amp.vca → io.audioOut` with `env.adsr` on the VCA by dragging; play a MIDI keyboard; hear it; scope widget shows the waveform.
4. While playing, add `mod.lfo` and connect it to the implicit `param:cutoff` jack: no dropout, filter sweeps.
5. Drag cutoff in the inspector: one history entry; `Cmd+Z` reverts audibly.
6. Save project to a folder; quit; reopen; `project.open` restores patch, viewport and selection; audio identical.
7. `kill -9` the engine: supervisor restarts it, reconciler reloads the patch, audio resumes.
8. `phasegrid-engine --render patches/main.json --seconds 2 --out out.wav` matches the golden render.


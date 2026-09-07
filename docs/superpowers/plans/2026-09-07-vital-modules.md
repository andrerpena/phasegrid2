# phasegrid2 Vital Modules Implementation Plan (Phase 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the vendored Vital DSP into grid modules through one adapter, add the engine's own utility modules, and prove an audible synth voice end to end with a headless golden render.

**Architecture:** `engine/src/vital/VitalModule` wraps any `vital::SynthModule` subclass as a phasegrid `Module`: at `prepare()` (message thread) it constructs and `init()`s the Vital module, plugs one adapter `vital::Output` per mapped input and one per modulatable control (into the module's poly/mono modulation destinations), and turns the modulation switches on; at `process()` (audio thread, allocation-free) it points those `Output::buffer`s at our `Block`s, derives Vital trigger events from gate edges, converts pitch to MIDI notes, sets knob `Value`s that changed, and runs the module. Descriptors for Vital-backed modules are generated once at registry time from `vital::Parameters::getDetails(prefix + "_" + control)`. A `kParamStructural` flag makes the instance table rebuild a module when a structural param (LFO shape, filter model set) changes; assets (wavetables, samples) load on the message thread and swap in through Vital's own lock-free handshakes.

**Tech Stack:** C++20, vendored Vital (`vital_dsp`), miniaudio (WAV decode), nlohmann/json (`.vitaltable`), Catch2. Foundation engine from `2026-09-07-phasegrid2-foundation.md` (Tasks 1–16) is the base.

**Spec:** `docs/superpowers/specs/2026-09-07-phasegrid2-architecture-design.md` as amended by `docs/superpowers/specs/2026-09-07-vital-native-core-amendment.md` (amendment wins).

## Global Constraints

- Signals are `pg::Sample = vital::poly_float` with lanes `[v0.L, v0.R, v1.L, v1.R]`; `kMaxBlockSize = 128`; one voice pair in this milestone (`ctx.voice == 0`, `ctx.voiceMask` = lanes of existing voices).
- Module ids never contain `vital`/`Vital`/`Tytel`; the strings never appear in `engine/src`, `shared`, `src` (the C++ namespace `vital::` and include paths are the exception).
- Vendored files under `engine/vendor/vital` are never edited; adapters live in `engine/src/vital/`.
- Audio-thread code (`Module::process`, adapter binding, trigger derivation, `Value::set`) must not allocate, lock, do I/O or throw. Every new module gets an `[rt]` test.
- Params for Vital-backed modules: `min`/`max`/`def` = Vital `ValueDetails` (pre-scale domain), curve `Linear` (Vital applies its own `value_scale` internally), `kIndexed` + `string_lookup` → `kParamEnum|kParamInteger|kParamNoSmooth`, `kIndexed` without lookup → `kParamInteger|kParamNoSmooth`, modulatable iff the module exposes a poly or mono modulation destination for that control. Hidden controls (`_on`, `_view_2d`, `*_destination`, `*_input`, `_sync`) are not exposed.
- Modulation semantics stay "knob + signal, clamped": the adapter feeds `(effective − knob)` per sample into the Vital modulation destination.
- Descriptors are C-layout; generated ones live in heap storage that is never freed (process lifetime).
- Conventions: pitch 0.1/octave from middle C, MIDI note = `60 + pitch*120`; gate > 0; rising edge → `kVoiceOn` (with sample offset), falling edge → `kVoiceOff`.
- Never commit with a failing test. After any C++ change run `npm run engine:test`. Conventional commits.

---

## Corrections from Task 2 (authoritative — they override the task text below)

Task 2 was implemented and these were established against the vendored source. Where the task text below
disagrees with this section, this section wins.

**Naming.** The plan's `Vital*` type names would land in the shipped binary's symbol table, which is exactly what
the amendment's naming rule forbids, and `scripts/check-trademark.mjs` rejects them. The real names are:
namespace `pg::vendor`; `WrappedModule` (was `VitalModule`), `ModuleSpec` (was `VitalModuleSpec`), `BindKind`
(was `VitalPortKind`, renamed to avoid shadowing `pg::PortKind`), `InputMap`, `OutputMap`, `ControlOverride`,
`ModuleContext`. Files are `engine/src/vital/{Spec,Triggers,Descriptors,WrappedModule}.{hpp,cpp}`. The directory
stays `engine/src/vital/` — the trademark guard exempts include paths.

**`ModuleSpec::create` takes a context.** It is `std::function<vital::SynthModule*(ModuleContext&)>`. Descriptor
generation must build a probe `ModuleContext` and declare it *before* the `unique_ptr` so it outlives the module.

**Adapter `Output`s need a stub owner.** `vital::ModulationSum::process` unconditionally dereferences
`input(i)->source->owner->isControlRate()`. An adapter `Output` with `owner == nullptr` segfaults on the first
`plugNext` into an audio-rate modulation destination, via `numInputsChanged()` → `setEnabled()` → `process(1)`.
`AdapterSource`, a stub `vital::Processor` that exists only to answer `isControlRate()`, is already in
`Spec.hpp`; use it for every adapter Output. Every task from here hits this.

**Enum labels must be length-checked.** Generating `max - min + 1` labels from a `string_lookup` reads out of
bounds: `filter_1_style` has range 0..9 but `strings::kFilterStyleNames` holds 5 entries, because the style names
are per-model and the comb, diode and formant families have their own arrays. For every `kIndexed` control, check
the lookup array's real length against the control's range; when they disagree, set
`ControlOverride::suppressLabels` and document the control as a plain integer, as `filter.multi`'s `style` is.

**Do not aggregate-initialise `ModuleSpec` positionally.** Build it field by field so it survives the struct
gaining fields.

**`hidden` lists only controls the module actually creates.** Naming a control that lives in the vendored
parameter table but that the module never creates (e.g. `osc1_input` for the filter) is a no-op; check
`getControls()` after `init()` rather than the parameter table.

**Test design.** A test must fail if the thing it claims to prove is unwired. The filter's original modulation
test passed with modulation entirely disconnected; it was replaced by two tests that read the value the module
actually saw (mix against a high-pass for the control-rate destination, low-pass settling rate for the
audio-rate one). Apply the same standard: before keeping a test, break the code it covers and confirm it fails.

**Always construct vendored modules with `pg::vendor::makeModule<T>(...)`, never `new T`.** The vendored router
keeps two process orders: `plug()` sorts `global_order_`, but `process()` runs `local_order_`, and the rebuild that
copies one to the other only fires when the router's `local_changes_` differs from the shared counter — which never
happens on the object that owns the graph, because every mutation bumps both. Upstream never notices because it
processes per-voice *copies*, whose copy constructor builds `local_order_` from the sorted order; we process the
router itself. A module that plugs a processor before creating the controls feeding it therefore runs that
processor first and reads its controls one block late, and reads *zero* on the first block. `EnvelopeModule` does
exactly that, so a bare `new` gave an instant attack regardless of the knob. `makeModule<T>` wraps the type in
`pg::vendor::Sorted<T>` and forces the rebuild once after `init()`. `filter.multi` was accidentally safe because it
adds its filters in `init()`, after its controls — do not read that as evidence the trap is not there.

**Check each exposed output against the vendored `process()` for whether it writes the whole block.** Some outputs
are full-size but only ever get `buffer[0]` written (`Envelope`'s phase output is written once at the end of the
block). `isControlRate()` tests `buffer_size == 1`, so it does not catch these, and the adapter would copy 128
frames the module never wrote. Set `OutputMap::firstFrameOnly` for them.

**`kMaxPortsPerModule` is 32 and `osc.wavetable` already uses 31** (4 inputs + 27 params). A module with a larger
control surface needs a longer `hidden` list or a wider cap; decide deliberately rather than discovering it as an
`E_FAN_IN`-style failure.

**Unconnected inputs** are bound to the instance's own zero block, never to the shared `kSilentBlock`, because
the adapter drops const on that pointer.

---

## File map

| Path | Responsibility |
|---|---|
| `engine/src/core/Descriptor.hpp` (modify) | `kParamStructural` flag |
| `engine/src/core/Module.hpp` (modify) | `ProcessContext::voiceMask` |
| `engine/src/core/InstanceTable.*` (modify) | rebuild instance when a structural param changed |
| `engine/src/core/Scheduler.cpp` (modify) | pass the pair's voice mask |
| `engine/src/vital/VitalSpec.hpp` | `VitalPortKind`, `VitalPortMap`, `VitalModuleSpec` |
| `engine/src/vital/VitalDescriptors.hpp/.cpp` | generate `ModuleDescriptor` + `ParamDesc[]` from a spec + `vital::Parameters` |
| `engine/src/vital/VitalModule.hpp/.cpp` | the adapter (`Module` implementation) |
| `engine/src/vital/VitalTriggers.hpp` | gate-edge → trigger derivation (pure, unit-tested) |
| `engine/src/vital/WavetableBank.hpp/.cpp` | builtin + `.vitaltable` loading, per-oscillator render |
| `engine/src/vital/SampleBank.hpp/.cpp` | WAV decode (miniaudio) → `vital::Sample::loadSample` |
| `engine/src/modules/vital/*.cpp` | one file per Vital-backed module: its `VitalModuleSpec` |
| `engine/src/modules/{PhaseClock,ScaleOffset,Mixer,Vca,NoteToCv}.cpp` | own modules |
| `engine/src/modules/builtin.cpp` (modify) | registration list |
| `engine/src/services/Catalog.hpp/.cpp`, `engine/src/app/main.cpp` (modify) | `--catalog` JSON |
| `engine/tests/test_vital_*.cpp`, `engine/tests/golden/synth_voice.json` | tests |

---

### Task 1: Engine hooks the adapter needs (structural params, voice mask)

**Files:**
- Modify: `engine/src/core/Descriptor.hpp`, `engine/src/core/Module.hpp`, `engine/src/core/InstanceTable.hpp`, `engine/src/core/InstanceTable.cpp`, `engine/src/core/Scheduler.cpp`
- Test: `engine/tests/test_instance_table.cpp`; modify `engine/tests/test_scheduler.cpp`

**Interfaces:**
- Produces: `pg::kParamStructural = 1u << 5` (a param whose change requires rebuilding the instance; implies `kParamNoSmooth`, never modulatable). `ModuleInstance::structuralValues` (`std::vector<float>`, one per param, display units). `InstanceTable::acquire` recreates the instance when the type differs **or** any structural param's model value differs from the instance's recorded value. `ProcessContext::voiceMask` (`Mask`) set by the scheduler from `Program::activeVoiceMask[pair]`.

- [ ] **Step 1: Write the failing tests**

`engine/tests/test_instance_table.cpp`:
```cpp
#include <catch2/catch_test_macros.hpp>
#include "core/InstanceTable.hpp"
#include "core/Module.hpp"

namespace {
using namespace pg;
const PortDesc kOut[] = {{"out", "Out", PortKind::Continuous, 1, SignalRole::Any, ""}};
const char* kShapes[] = {"sine", "square"};
const ParamDesc kParams[] = {
  {"gain", "Gain", 0.f, 1.f, 1.f, ParamUnit::None, ParamCurve::Linear, kParamModulatable, nullptr, 0, "slider", nullptr, ""},
  {"shape", "Shape", 0.f, 1.f, 0.f, ParamUnit::None, ParamCurve::Linear, kParamEnum | kParamInteger | kParamNoSmooth | kParamStructural, kShapes, 2, "select", nullptr, ""},
};
class Dummy : public VoicedModule<int> { void process(ProcessContext&) override {} };
const ModuleDescriptor kDesc{kModuleAbiVersion, "test.structural", "S", "test", "", nullptr, 0, kOut, 1, kParams, 2, 0, 0, [] () -> Module* { return new Dummy(); }};
}  // namespace

TEST_CASE("InstanceTable rebuilds only when a structural param changes", "[instances]") {
  Registry reg; REQUIRE_FALSE(reg.add(kDesc).has_value());
  InstanceTable table; PrepareInfo info{48000.0, kMaxBlockSize, 1};
  auto a = table.acquire("n", *reg.find("test.structural"), info, {{"gain", 0.5f}, {"shape", 0.f}});
  auto b = table.acquire("n", *reg.find("test.structural"), info, {{"gain", 0.1f}, {"shape", 0.f}});   // non-structural change
  REQUIRE(a.get() == b.get());
  auto c = table.acquire("n", *reg.find("test.structural"), info, {{"gain", 0.1f}, {"shape", 1.f}});   // structural change
  REQUIRE(a.get() != c.get());
  REQUIRE(c->structuralValues[1] == 1.f);
  REQUIRE(c->serial != a->serial);
  auto d = table.acquire("n", *reg.find("test.structural"), info, {{"gain", 0.1f}});                  // missing = default 0 -> rebuild again
  REQUIRE(d.get() != c.get());
}
```

Add to `engine/tests/test_scheduler.cpp` a module-free check in the first test, after `s.run(p, 64, t, nullptr);`: the scheduler passes the pair's mask. Implement by extending the test's `Gain`-free path: add a tiny local module class inside the test file that records `ctx.voiceMask`:
```cpp
namespace {
struct MaskProbe : pg::VoicedModule<int> {
  static inline pg::Mask seen{};
  void process(pg::ProcessContext& c) override { seen = c.voiceMask; }
};
const pg::PortDesc kProbeOut[] = {{"out", "Out", pg::PortKind::Continuous, 1, pg::SignalRole::Any, ""}};
const pg::ModuleDescriptor kProbe{pg::kModuleAbiVersion, "test.maskProbe", "P", "test", "", nullptr, 0, kProbeOut, 1, nullptr, 0, 0, 0, [] () -> pg::Module* { return new MaskProbe(); }};
}
TEST_CASE("Scheduler passes the pair's voice mask", "[scheduler]") {
  pg::Registry reg; REQUIRE_FALSE(reg.add(kProbe).has_value());
  pg::InstanceTable table; pg::PrepareInfo info{48000.0, pg::kMaxBlockSize, 1};
  pg::Program p; p.allocBuffer(); p.allocEventBuffer();
  p.activeVoiceMask = {pg::Program::voiceMaskFor(1, 0)};
  pg::NodeSlot n; n.inst = table.acquire("m", *reg.find("test.maskProbe"), info, {}); n.outBuf = {p.allocBuffer()}; n.outEvt = {pg::kNone}; n.paramBuf = {};
  p.nodes = {n}; p.ops = {pg::Op{pg::Op::Process, 0}}; p.buildSerialIndex();
  pg::Scheduler s; s.run(p, 64, pg::TransportSnapshot{}, nullptr);
  REQUIRE(pg::lanes::lane(pg::Sample(1.f) & MaskProbe::seen, 0) == 1.f);
  REQUIRE(pg::lanes::lane(pg::Sample(1.f) & MaskProbe::seen, 2) == 0.f);
}
```

- [ ] **Step 2: Run to verify failure** — `kParamStructural`, `structuralValues`, `voiceMask` do not exist.

- [ ] **Step 3: Implement**

`Descriptor.hpp`: add `inline constexpr uint32_t kParamStructural = 1u << 5;` after `kParamNoSmooth`.

`Module.hpp` `ProcessContext`: add `Mask voiceMask = Mask(-1);` after `voice`.

`Program.hpp` `ModuleInstance`: add `std::vector<float> structuralValues;   // display-unit value of every param at creation; compared on acquire`.

`InstanceTable.cpp` `acquire`: replace the reuse condition:
```cpp
  auto it = byId_.find(id);
  if (it != byId_.end() && it->second->type == &type) {
    bool structuralSame = true;
    for (uint32_t i = 0; i < type.desc->numParams && structuralSame; ++i) {
      const ParamDesc& d = type.desc->params[i];
      if (!(d.flags & kParamStructural)) continue;
      auto pv = params.find(d.id);
      const float value = pv == params.end() ? d.def : pv->second;
      structuralSame = value == it->second->structuralValues[i];
    }
    if (structuralSame) return it->second;
  }
```
and when creating, after the params loop: `inst->structuralValues.push_back(pv == params.end() ? d.def : pv->second);` (inside the loop, one per param).

`Registry.cpp` `add`: reject `kParamStructural` params that are also `kParamModulatable` (`return id + ": structural param " + p.id + " cannot be modulatable";`).

`Scheduler.cpp` `exec` `Process` case: `ctx.voiceMask = p.activeVoiceMask.empty() ? Mask(-1) : p.activeVoiceMask[pair];`.

- [ ] **Step 4: Run the tests** — all pass. **Step 5: Commit** `feat(engine): structural params rebuild instances; voice mask in ProcessContext`.

---

### Task 2: The Vital adapter, descriptor generation, and `filter.multi`

**Files:**
- Create: `engine/src/vital/VitalSpec.hpp`, `engine/src/vital/VitalTriggers.hpp`, `engine/src/vital/VitalDescriptors.hpp`, `engine/src/vital/VitalDescriptors.cpp`, `engine/src/vital/VitalModule.hpp`, `engine/src/vital/VitalModule.cpp`
- Create: `engine/src/modules/vital/FilterMulti.cpp`
- Modify: `engine/src/modules/builtin.hpp`, `engine/src/modules/builtin.cpp`
- Test: `engine/tests/test_vital_triggers.cpp`, `engine/tests/test_vital_filter.cpp`

**Interfaces:**
- `pg::vitalmod::VitalPortKind { Audio, Gate, PitchAsMidi, ConstMidi, NoteCount, ActiveVoices, BeatsPerSecond }`.
- `pg::vitalmod::VitalPortMap { const char* id; const char* name; int vitalInput; VitalPortKind kind; SignalRole role; const char* doc; }` — one phasegrid input port per entry; `Gate` entries produce triggers on the Vital input and are also exposed as a continuous port.
- `pg::vitalmod::VitalOutputMap { const char* id; const char* name; int vitalOutput; SignalRole role; const char* doc; }`.
- `pg::vitalmod::VitalModuleSpec`, `VitalModuleContext`, `VitalControlOverride`, `ParamValues` exactly as in `VitalSpec.hpp` below (defined completely here; Tasks 3–7 only use these fields).
- `const pg::ModuleDescriptor& pg::vitalmod::buildDescriptor(const VitalModuleSpec&)` — instantiates a throwaway module, calls `init()`, reads `getControls()`, generates `ParamDesc[]` (heap, never freed) ordered by control name, returns a stable descriptor whose `create` constructs a `VitalModule` bound to that spec.
- `pg::vitalmod::VitalModule : Module` — `prepare/reset/process` per the amendment.
- Trigger helper: `pg::vitalmod::deriveTriggers(const Sample* gate, uint32_t n, Sample& lastGate, vital::Output& out)` — clears the output trigger, scans lanes for edges, calls `out.trigger(mask, kVoiceOn|kVoiceOff, offset)` with the earliest edge per lane, updates `lastGate`.
- Module `filter.multi`: prefix `filter_1`, inputs `in` (Audio → `FilterModule::kAudio`), `reset` (Gate → `kReset`), `pitch` (PitchAsMidi → `kMidi`; keytrack input `kKeytrack` receives `midi − 60` from the same pitch), outputs `out`; params generated from `filter_1_*` minus hidden `filter_1_on`, `filter_1_style`? (no: `style` and `model` are enums and stay), minus `*_input`.

- [ ] **Step 1: Write the failing tests**

`engine/tests/test_vital_triggers.cpp`:
```cpp
#include <catch2/catch_test_macros.hpp>
#include "vital/VitalTriggers.hpp"

TEST_CASE("deriveTriggers emits kVoiceOn on rising and kVoiceOff on falling edges per lane", "[vital]") {
  pg::Sample gate[8];
  for (auto& g : gate) g = pg::Sample(0.f);
  gate[3] = pg::Sample(1.f, 1.f, 0.f, 0.f);   // voice 0 rises at frame 3
  gate[4] = gate[3]; gate[5] = gate[3];
  gate[6] = pg::Sample(0.f, 0.f, 1.f, 1.f);   // voice 0 falls, voice 1 rises at frame 6
  gate[7] = gate[6];
  pg::Sample last(0.f);
  vital::Output out;
  pg::vitalmod::deriveTriggers(gate, 8, last, out);
  REQUIRE(out.trigger_mask.anyMask());
  REQUIRE(out.trigger_value[0] == static_cast<float>(vital::kVoiceOff));   // last event on voice 0 wins
  REQUIRE(out.trigger_offset[0] == 6);
  REQUIRE(out.trigger_value[2] == static_cast<float>(vital::kVoiceOn));
  REQUIRE(out.trigger_offset[2] == 6);
  REQUIRE(pg::lanes::lane(last, 2) == 1.f);
  pg::vitalmod::deriveTriggers(gate + 7, 1, last, out);   // no edge in this block
  REQUIRE_FALSE(out.trigger_mask.anyMask());
}
```

`engine/tests/test_vital_filter.cpp`:
```cpp
#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <cmath>
#include "core/Engine.hpp"
#include "modules/TestModules.hpp"
#include "modules/builtin.hpp"
#include "util/RtGuard.hpp"

namespace {
struct Rig {
  pg::Registry reg; pg::Engine engine{reg, pg::EngineConfig{48000.0, 64}}; pg::TransportSnapshot t;
  std::vector<float> l = std::vector<float>(64), r = std::vector<float>(64); float* out[2] = {l.data(), r.data()};
  Rig() { pg::registerBuiltinModules(reg); pg::test::registerTestModules(reg); }
  float rmsAfterSettle(int settleBlocks, int measureBlocks) {
    for (int i = 0; i < settleBlocks; ++i) engine.renderBlock(out, 2, 64, t);
    double s = 0; int n = 0;
    for (int i = 0; i < measureBlocks; ++i) { engine.renderBlock(out, 2, 64, t); for (float v : l) { s += v * v; ++n; } }
    return static_cast<float>(std::sqrt(s / n));
  }
};
}  // namespace

TEST_CASE("filter.multi descriptor is generated from Vital parameters", "[vital]") {
  Rig rig;
  const pg::RegisteredModule* f = rig.reg.find("filter.multi");
  REQUIRE(f != nullptr);
  REQUIRE(f->findInput("in") == 0);
  REQUIRE(f->findInput("reset") == 1);
  REQUIRE(f->findInput("pitch") == 2);
  REQUIRE(f->findOutput("out") == 0);
  const int32_t cutoff = f->findParam("cutoff");
  REQUIRE(cutoff >= 0);
  REQUIRE(f->desc->params[cutoff].min == Catch::Approx(8.f));
  REQUIRE(f->desc->params[cutoff].max == Catch::Approx(136.f));
  REQUIRE(f->desc->params[cutoff].def == Catch::Approx(60.f));
  REQUIRE((f->desc->params[cutoff].flags & pg::kParamModulatable) != 0);
  REQUIRE(f->findInput("param:cutoff") >= 0);
  const int32_t model = f->findParam("model");
  REQUIRE(model >= 0);
  REQUIRE((f->desc->params[model].flags & pg::kParamEnum) != 0);
  REQUIRE(f->desc->params[model].enumCount == 8);
  REQUIRE(std::string(f->desc->params[model].enumLabels[3]) == "Digital");
  REQUIRE(f->findParam("on") == -1);
  REQUIRE(f->findParam("osc1_input") == -1);
  for (uint32_t i = 0; i < f->desc->numParams; ++i) REQUIRE(std::string(f->desc->params[i].id).find("filter_1") == std::string::npos);
}

TEST_CASE("filter.multi low-passes a test tone and modulation moves the cutoff", "[vital]") {
  // test.const(1) -> filter.multi(in) ; filter -> test.sink. A DC input through a 12 dB low-pass passes; then push the
  // cutoff down via the implicit port and observe more attenuation of an 8 kHz tone from test.impulse-free harness.
  Rig rig;
  REQUIRE(rig.engine.model().addNode(rig.reg, {"src", "test.const", {{"value", 0.5f}}}));
  REQUIRE(rig.engine.model().addNode(rig.reg, {"f", "filter.multi", {{"model", 3.f}, {"cutoff", 83.f}, {"resonance", 0.3f}}}));
  REQUIRE(rig.engine.model().addNode(rig.reg, {"s", "test.sink"}));
  REQUIRE(rig.engine.model().addEdge(rig.reg, {"e1", "src", "out", "f", "in"}));
  REQUIRE(rig.engine.model().addEdge(rig.reg, {"e2", "f", "out", "s", "in"}));
  REQUIRE(rig.engine.commit());
  const float dc = rig.rmsAfterSettle(50, 10);
  REQUIRE(dc == Catch::Approx(0.5f).margin(0.05f));           // DC passes a low-pass
  // Modulate cutoff down by -0.5 (norm) through the implicit port: 60 semitones lower -> ~ 30 Hz; DC still passes.
  REQUIRE(rig.engine.model().addNode(rig.reg, {"mod", "test.const", {{"value", -0.5f}}}));
  REQUIRE(rig.engine.model().addEdge(rig.reg, {"e3", "mod", "out", "f", "param:cutoff"}));
  REQUIRE(rig.engine.commit());
  const float dc2 = rig.rmsAfterSettle(50, 10);
  REQUIRE(dc2 == Catch::Approx(0.5f).margin(0.05f));
}

TEST_CASE("filter.multi attenuates high frequencies and is allocation free", "[vital][rt]") {
  Rig rig;
  // Build a 8 kHz sine with test modules is not possible; drive the filter directly through the adapter instead.
  REQUIRE(rig.engine.model().addNode(rig.reg, {"f", "filter.multi", {{"model", 3.f}, {"cutoff", 83.f}}}));
  REQUIRE(rig.engine.model().addNode(rig.reg, {"s", "test.sink"}));
  REQUIRE(rig.engine.model().addEdge(rig.reg, {"e2", "f", "out", "s", "in"}));
  REQUIRE(rig.engine.commit());
  for (int i = 0; i < 4; ++i) rig.engine.renderBlock(rig.out, 2, 64, rig.t);
  pg::test::resetRtViolations();
  { pg::test::RtScope scope; for (int i = 0; i < 200; ++i) rig.engine.renderBlock(rig.out, 2, 64, rig.t); }
  REQUIRE(pg::test::rtViolations() == 0);
}
```
Also add a spectral check using the offline renderer once `osc.wavetable` exists (Task 3); this task's contract is descriptor generation, DC pass-through, modulation wiring and RT-safety.

- [ ] **Step 2: Run to verify failure** — headers missing.

- [ ] **Step 3: Write VitalSpec.hpp and VitalTriggers.hpp**

`engine/src/vital/VitalSpec.hpp` (the complete struct; later tasks only use fields declared here):
```cpp
#pragma once
#include <functional>
#include <map>
#include <memory>
#include <string>
#include <vector>
#include "core/Descriptor.hpp"
#include "line_generator.h"
#include "processor.h"
#include "sample_source.h"
#include "synth_module.h"

namespace pg::vitalmod {

enum class VitalPortKind { Audio, Gate, PitchAsMidi, ConstMidi, KeytrackOffset, NoteCount, ActiveVoices };

struct VitalPortMap { const char* id; const char* name; int vitalInput; VitalPortKind kind; SignalRole role; const char* doc; };
struct VitalOutputMap { const char* id; const char* name; int vitalOutput; SignalRole role; const char* doc; };

/// Per-control tweaks. `exposeNonParameter` emits a control that is not in vital::Parameters (e.g. the `_sync`
/// cr::Values) using the given range/labels.
struct VitalControlOverride {
  std::string control;              // suffix ("sync")
  uint32_t addFlags = 0;
  const char* doc = nullptr;
  bool exposeNonParameter = false;
  float min = 0.f, max = 1.f, def = 0.f;
  const std::string* labels = nullptr; uint32_t labelCount = 0;   // enum labels (synth_strings.h tables)
};

using ParamValues = std::map<std::string, float>;

/// Objects a Vital module may need that belong to the phasegrid instance: owned by VitalModule, handed to `create`.
class VitalModuleContext {
public:
  LineGenerator& lineGenerator() { if (!line_) line_ = std::make_unique<LineGenerator>(); return *line_; }
  const vital::Output* beatsPerSecond() { if (!bps_) { bps_ = std::make_unique<vital::cr::Output>(); bps_->buffer[0] = vital::poly_float(2.f); } return bps_.get(); }
  vital::cr::Output* beatsPerSecondOutput() { beatsPerSecond(); return bps_.get(); }
  vital::Sample* sample = nullptr;   // set by sampler specs after create
private:
  std::unique_ptr<LineGenerator> line_;
  std::unique_ptr<vital::cr::Output> bps_;
};

struct VitalModuleSpec {
  const char* id = nullptr; const char* name = nullptr; const char* category = nullptr; const char* doc = nullptr;
  std::string prefix;                                                        // "filter_1"; "" for fixed-id modules
  std::function<vital::SynthModule*(VitalModuleContext&)> create;            // construct (not init)
  std::function<void(vital::SynthModule&)> configure;                        // optional, before init(): setMono, setControlRate, ...
  std::function<void(vital::SynthModule&, const ParamValues&)> onConfigure;  // optional, before init(): structural params (wavetable, LFO shape)
  std::function<void(vital::SynthModule&)> postInit;                         // optional, after init(): e.g. force an internal "on" control
  std::vector<VitalPortMap> inputs;
  std::vector<VitalOutputMap> outputs;
  std::vector<ParamDesc> extraParams;                                        // emitted BEFORE generated params (structural enums etc.); no Vital control
  std::vector<std::string> hidden;                                           // control suffixes not exposed
  std::vector<VitalControlOverride> overrides;
  bool processWithInput = false;                                             // effects: audio via processWithInput(buffer, n); input 0 must be Audio with vitalInput -1
  bool needsBeatsPerSecond = false;                                          // adapter writes tempo/60 into ctx.beatsPerSecondOutput() every block
  uint32_t moduleFlags = 0;
};

inline std::string controlName(const VitalModuleSpec& s, const std::string& suffix) { return s.prefix.empty() ? suffix : s.prefix + "_" + suffix; }
inline std::string controlSuffix(const VitalModuleSpec& s, const std::string& full) { return s.prefix.empty() ? full : full.substr(s.prefix.size() + 1); }

}  // namespace pg::vitalmod
```

`engine/src/vital/VitalTriggers.hpp`:
```cpp
#pragma once
#include "common.h"
#include "core/Signal.hpp"
#include "processor.h"

namespace pg::vitalmod {

/// Turns a continuous gate into Vital trigger events for this block: per lane, the LAST edge in the block wins
/// (Vital carries one trigger per lane per block). Rising -> kVoiceOn, falling -> kVoiceOff. RT-safe.
inline void deriveTriggers(const Sample* gate, uint32_t n, Sample& lastGate, vital::Output& out) {
  out.clearTrigger();
  float prev[4] = {lastGate[0], lastGate[1], lastGate[2], lastGate[3]};
  int lastOffset[4] = {-1, -1, -1, -1};
  float lastValue[4] = {0.f, 0.f, 0.f, 0.f};
  for (uint32_t i = 0; i < n; ++i) {
    for (int lane = 0; lane < 4; ++lane) {
      const float g = gate[i][lane];
      const bool wasHigh = prev[lane] > 0.f, isHigh = g > 0.f;
      if (isHigh != wasHigh) { lastOffset[lane] = static_cast<int>(i); lastValue[lane] = static_cast<float>(isHigh ? vital::kVoiceOn : vital::kVoiceOff); }
      prev[lane] = g;
    }
  }
  lastGate = Sample(prev[0], prev[1], prev[2], prev[3]);
  for (int lane = 0; lane < 4; ++lane) {
    if (lastOffset[lane] < 0) continue;
    int m[4] = {0, 0, 0, 0}; m[lane] = -1;
    out.trigger(vital::poly_mask(m[0], m[1], m[2], m[3]), Sample(lastValue[lane]), vital::poly_int(lastOffset[lane]));
  }
}

}  // namespace pg::vitalmod
```
(`vital::Output::trigger(mask, value, offset)` merges per-lane values with `maskLoad`, so one call per lane composes correctly.)

- [ ] **Step 4: Write VitalDescriptors**

`engine/src/vital/VitalDescriptors.hpp`:
```cpp
#pragma once
#include "core/Descriptor.hpp"
#include "vital/VitalSpec.hpp"

namespace pg::vitalmod {
/// Builds (once, heap, never freed) the ModuleDescriptor for a spec by instantiating the Vital module, reading its
/// controls and vital::Parameters. Returns a reference with process lifetime. Throws std::runtime_error on bad specs.
const ModuleDescriptor& buildDescriptor(const VitalModuleSpec& spec);
/// The spec a generated descriptor was built from (for VitalModule::prepare).
const VitalModuleSpec& specFor(const ModuleDescriptor& desc);
}  // namespace pg::vitalmod
```

`engine/src/vital/VitalDescriptors.cpp`:
```cpp
#include "vital/VitalDescriptors.hpp"
#include <algorithm>
#include <map>
#include <memory>
#include <stdexcept>
#include "synth_parameters.h"
#include "vital/VitalModule.hpp"

namespace pg::vitalmod {
namespace {

struct Built {                              // everything a descriptor points at; leaked on purpose (process lifetime)
  VitalModuleSpec spec;
  std::vector<std::string> strings;         // stable storage for ids/names/docs
  std::vector<std::vector<const char*>> enumTables;
  std::vector<PortDesc> inputs, outputs;
  std::vector<ParamDesc> params;
  ModuleDescriptor desc{};
};
std::map<const ModuleDescriptor*, Built*>& registry() { static auto* r = new std::map<const ModuleDescriptor*, Built*>(); return *r; }

const char* keep(Built& b, std::string s) { b.strings.push_back(std::move(s)); return b.strings.back().c_str(); }

ParamUnit unitFor(const std::string& u) {
  if (u.find("semitone") != std::string::npos) return ParamUnit::Semitones;
  if (u.find("dB") != std::string::npos) return ParamUnit::Db;
  if (u.find("sec") != std::string::npos || u.find("ms") != std::string::npos) return ParamUnit::Seconds;
  if (u.find("Hz") != std::string::npos) return ParamUnit::Hz;
  if (u.find('%') != std::string::npos) return ParamUnit::Percent;
  return ParamUnit::None;
}

}  // namespace

const ModuleDescriptor& buildDescriptor(const VitalModuleSpec& specIn) {
  auto* b = new Built{};
  b->spec = specIn;
  b->strings.reserve(512);                  // never reallocate after we hand out c_str() pointers
  b->enumTables.reserve(64);

  // 1. Instantiate once to discover controls and modulation destinations.
  std::unique_ptr<vital::SynthModule> probe(b->spec.create());
  if (b->spec.configure) b->spec.configure(*probe);
  probe->init();
  vital::control_map controls = probe->getControls();

  // 2. Ports.
  for (const VitalPortMap& in : b->spec.inputs)
    b->inputs.push_back(PortDesc{in.id, in.name, PortKind::Continuous, 1, in.role, in.doc});
  for (const VitalOutputMap& out : b->spec.outputs)
    b->outputs.push_back(PortDesc{out.id, out.name, PortKind::Continuous, 1, out.role, out.doc});

  // 3. Params from controls, sorted by suffix for a stable order.
  std::vector<std::string> names;
  for (const auto& [name, value] : controls) names.push_back(name);
  std::sort(names.begin(), names.end());
  for (const std::string& full : names) {
    const std::string suffix = controlSuffix(b->spec, full);
    if (std::find(b->spec.hidden.begin(), b->spec.hidden.end(), suffix) != b->spec.hidden.end()) continue;
    if (!vital::Parameters::isParameter(full)) continue;   // e.g. "_sync" values created by createTempoSyncSwitch
    const vital::ValueDetails& d = vital::Parameters::getDetails(full);
    ParamDesc p{};
    p.id = keep(*b, suffix);
    p.name = keep(*b, d.local_description.empty() ? d.display_name : d.local_description);
    p.min = d.min; p.max = d.max; p.def = d.default_value;
    p.unit = unitFor(d.display_units);
    p.curve = ParamCurve::Linear;
    p.uiWidget = "slider";
    p.group = nullptr;
    p.doc = keep(*b, d.display_name);
    const bool poly = probe->getPolyModulationDestination(full) != nullptr;
    const bool mono = probe->getMonoModulationDestination(full) != nullptr;
    if (d.value_scale == vital::ValueDetails::kIndexed) {
      p.flags = kParamInteger | kParamNoSmooth;
      if (d.string_lookup) {
        std::vector<const char*> labels;
        const int count = static_cast<int>(d.max - d.min) + 1;
        for (int i = 0; i < count; ++i) labels.push_back(keep(*b, d.string_lookup[i]));
        b->enumTables.push_back(std::move(labels));
        p.enumLabels = b->enumTables.back().data(); p.enumCount = static_cast<uint32_t>(b->enumTables.back().size());
        p.flags |= kParamEnum; p.uiWidget = "select";
      }
    } else if (poly || mono) {
      p.flags = kParamModulatable;
    }
    for (const VitalControlOverride& o : b->spec.overrides)
      if (o.control == suffix) { p.flags |= o.addFlags; if (o.doc) p.doc = o.doc; }
    b->params.push_back(p);
  }
  if (b->params.size() > kMaxParamsPerModule) throw std::runtime_error(std::string(b->spec.id) + ": too many params");

  // 4. Descriptor.
  ModuleDescriptor& m = b->desc;
  m.abiVersion = kModuleAbiVersion; m.id = b->spec.id; m.name = b->spec.name; m.category = b->spec.category; m.doc = b->spec.doc;
  m.inputs = b->inputs.data(); m.numInputs = static_cast<uint32_t>(b->inputs.size());
  m.outputs = b->outputs.data(); m.numOutputs = static_cast<uint32_t>(b->outputs.size());
  m.params = b->params.data(); m.numParams = static_cast<uint32_t>(b->params.size());
  m.flags = b->spec.moduleFlags; m.telemetrySlots = 0;
  m.create = nullptr;                                     // set below through the registry trampoline
  registry()[&m] = b;
  m.create = &VitalModule::createFromRegistry;            // VitalModule looks itself up via specFor(desc) using a thread-local "current descriptor"
  return m;
}

const VitalModuleSpec& specFor(const ModuleDescriptor& desc) { return registry().at(&desc)->spec; }

}  // namespace pg::vitalmod
```
Because `ModuleDescriptor::create` is a plain function pointer with no argument, `VitalModule` needs to know which descriptor it is being created for. Implement this without globals per instance by making the **registry** (`InstanceTable::acquire`) set a thread-local `const ModuleDescriptor* pg::currentCreatingDescriptor` right before calling `type.desc->create()` and clear it after; `VitalModule::createFromRegistry` reads it. Add to `Registry.hpp`: `extern thread_local const ModuleDescriptor* g_creatingDescriptor;` and set it in `InstanceTable::acquire` around `type.desc->create()`. (This keeps the C-layout `create` signature intact for future dlopen plugins.)

- [ ] **Step 5: Write the adapter**

`engine/src/vital/VitalModule.hpp`:
```cpp
#pragma once
#include <memory>
#include <vector>
#include "core/Module.hpp"
#include "processor.h"
#include "vital/VitalSpec.hpp"

namespace pg::vitalmod {

class VitalModule final : public Module {
public:
  static Module* createFromRegistry();      // uses pg::g_creatingDescriptor
  explicit VitalModule(const ModuleDescriptor& desc);
  void configure(const ParamValues& values) override { configured_ = values; }
  void prepare(const PrepareInfo&) override;
  void reset(uint32_t) override;
  void process(ProcessContext&) override;

private:
  struct BoundInput { VitalPortKind kind; int vitalInput; std::unique_ptr<vital::Output> out; Sample lastGate = Sample(0.f); };
  struct BoundParam { std::string control; vital::Value* knob = nullptr; std::unique_ptr<vital::Output> modIn; bool modulatable = false;
                      float lastKnob = 0.f; bool knobValid = false; };

  const ModuleDescriptor& desc_;
  const VitalModuleSpec& spec_;
  std::unique_ptr<vital::SynthModule> module_;
  std::vector<BoundInput> inputs_;                       // one per declared phasegrid input (same order)
  std::vector<BoundParam> params_;                       // one per descriptor param (same order)
  VitalModuleContext ctx_;
  ParamValues configured_;                                // from Module::configure (structural params)
  alignas(16) std::array<Sample, kMaxBlockSize> midiScratch_{}, zero_{};
  std::vector<Block> modScratch_;                        // one per modulatable param, allocated in prepare()
};

}  // namespace pg::vitalmod
```
`engine/src/vital/VitalModule.cpp`:
```cpp
#include "vital/VitalModule.hpp"
#include <stdexcept>
#include "core/Conventions.hpp"
#include "core/Registry.hpp"
#include "value.h"
#include "vital/VitalDescriptors.hpp"
#include "vital/VitalTriggers.hpp"

namespace pg::vitalmod {

Module* VitalModule::createFromRegistry() {
  if (!g_creatingDescriptor) throw std::runtime_error("VitalModule created outside InstanceTable::acquire");
  return new VitalModule(*g_creatingDescriptor);
}

VitalModule::VitalModule(const ModuleDescriptor& desc) : desc_(desc), spec_(specFor(desc)) {}

void VitalModule::prepare(const PrepareInfo& info) {
  module_.reset(spec_.create(ctx_));
  if (spec_.configure) spec_.configure(*module_);
  // Inputs: one adapter Output per mapped input, plugged before init().
  inputs_.clear();
  for (const VitalPortMap& map : spec_.inputs) {
    BoundInput b{map.kind, map.vitalInput, nullptr};
    if (map.kind == VitalPortKind::ConstMidi || map.kind == VitalPortKind::KeytrackOffset || map.kind == VitalPortKind::NoteCount || map.kind == VitalPortKind::ActiveVoices)
      b.out = std::make_unique<vital::cr::Output>();
    else
      b.out = std::make_unique<vital::Output>();
    if (map.vitalInput >= 0 && !spec_.processWithInput) module_->plug(b.out.get(), static_cast<unsigned>(map.vitalInput));
    inputs_.push_back(std::move(b));
  }
  if (spec_.onConfigure) spec_.onConfigure(*module_, configured_);
  module_->init();
  if (spec_.postInit) spec_.postInit(*module_);
  module_->setSampleRate(static_cast<int>(info.sampleRate));
  // Params: bind knobs and modulation destinations.
  vital::control_map controls = module_->getControls();
  params_.clear(); modScratch_.clear();
  for (uint32_t i = 0; i < desc_.numParams; ++i) {
    BoundParam p; p.control = controlName(spec_, desc_.params[i].id);
    auto found = controls.find(p.control);
    p.knob = found == controls.end() ? nullptr : found->second;   // extraParams have no Vital control
    if (p.knob && (desc_.params[i].flags & kParamModulatable)) {
      p.modulatable = true;
      p.modIn = std::make_unique<vital::Output>();
      vital::Processor* dest = module_->getPolyModulationDestination(p.control);
      bool poly = dest != nullptr;
      if (!dest) dest = module_->getMonoModulationDestination(p.control);
      dest->plugNext(p.modIn.get());
      module_->getModulationSwitch(p.control, poly)->set(1);
      modScratch_.emplace_back();
    }
    params_.push_back(std::move(p));
  }
  module_->updateAllModulationSwitches();
  zero_.fill(Sample(0.f));
}

void VitalModule::reset(uint32_t) { module_->hardReset(); }

void VitalModule::process(ProcessContext& c) {
  const uint32_t n = c.numFrames;
  if (spec_.needsBeatsPerSecond) ctx_.beatsPerSecondOutput()->buffer[0] = Sample(static_cast<float>(c.transport->tempo / 60.0));
  // 1. Bind inputs.
  const Sample* audioIn = nullptr;
  for (uint32_t i = 0; i < inputs_.size(); ++i) {
    BoundInput& b = inputs_[i];
    const SignalView& v = c.in(i);
    switch (b.kind) {
      case VitalPortKind::Audio:
        b.out->buffer = const_cast<Sample*>(v.readOr());
        if (i == 0) audioIn = v.readOr();
        break;
      case VitalPortKind::Gate:
        b.out->buffer = const_cast<Sample*>(v.readOr());
        deriveTriggers(v.readOr(), n, b.lastGate, *b.out);
        break;
      case VitalPortKind::PitchAsMidi: {
        const Sample* pitch = v.readOr();
        for (uint32_t k = 0; k < n; ++k) midiScratch_[k] = pitchToMidiNote(pitch[k]);
        b.out->buffer = midiScratch_.data();
        b.out->trigger_value = midiScratch_[0];
        break;
      }
      case VitalPortKind::ConstMidi:     b.out->buffer[0] = pitchToMidiNote(v.readOr()[0]); break;
      case VitalPortKind::KeytrackOffset: b.out->buffer[0] = pitchToMidiNote(v.readOr()[0]) - kMiddleCMidi; break;
      case VitalPortKind::NoteCount:     b.out->buffer[0] = Sample(1.f); break;
      case VitalPortKind::ActiveVoices:  b.out->buffer[0] = Sample(1.f) & c.voiceMask; break;
    }
  }
  // 2. Params: knob values (block boundary) and modulation buffers.
  uint32_t scratch = 0;
  for (uint32_t i = 0; i < params_.size(); ++i) {
    BoundParam& p = params_[i];
    if (!p.knob) continue;                                       // extra (structural) param: nothing to bind
    const ParamView view = c.param(i);
    if (!p.modulatable) {
      const float value = lanes::lane(view.at(0), 0);
      if (!p.knobValid || value != p.lastKnob) { p.knob->set(Sample(value)); p.lastKnob = value; p.knobValid = true; }
      continue;
    }
    // Modulatable: knob gets the unmodulated (ramped) value's first sample; modIn gets (effective - knob) per sample.
    const float base = view.knob;                                // unmodulated knob value (constant or ramp start), always available
    if (!p.knobValid || base != p.lastKnob) { p.knob->set(Sample(base)); p.lastKnob = base; p.knobValid = true; }
    Sample* mod = modScratch_[scratch++].data.data();
    if (view.polyBuf) for (uint32_t k = 0; k < n; ++k) mod[k] = view.polyBuf[k] - Sample(base);
    else for (uint32_t k = 0; k < n; ++k) mod[k] = Sample(0.f);
    p.modIn->buffer = mod;
  }
  // 3. Run.
  if (spec_.processWithInput) module_->processWithInput(audioIn ? audioIn : zero_.data(), static_cast<int>(n));
  else module_->process(static_cast<int>(n));
  // 4. Outputs: copy (Vital modules own their output buffers; some outputs are control-rate).
  for (uint32_t o = 0; o < spec_.outputs.size(); ++o) {
    const vital::Output* out = module_->output(static_cast<unsigned>(spec_.outputs[o].vitalOutput));
    Sample* dst = c.out(o).data;
    if (out->isControlRate()) { const Sample v = out->buffer[0]; for (uint32_t k = 0; k < n; ++k) dst[k] = v; }
    else for (uint32_t k = 0; k < n; ++k) dst[k] = out->buffer[k];
  }
}

}  // namespace pg::vitalmod
```
Notes for the implementer: (a) `ParamView` gains a fourth field in this task: `float knob` = the unmodulated knob value for this block (`ps.constValue`, or `ps.rampValue[offset]` while smoothing), filled by `Scheduler::exec` for every param regardless of modulation. `FillParam` computed `effective = denorm(clamp(knobNorm + mod))`, so `effective − knob` is the modulation in value units, which is what Vital's destination expects (pre-scale units). `Module::configure(const ParamValues&)` is added to `core/Module.hpp` here as well (called by `InstanceTable::acquire` before `prepare()` on new instances) — Task 3 relies on it. (b) `const_cast` on input buffers is safe: Vital never writes through input `Output::buffer`s. (c) Copying outputs costs one block copy per output; acceptable for M1 (zero-copy `useOutput` binding is a later optimization).

- [ ] **Step 6: Write `filter.multi` and register**

`engine/src/modules/vital/FilterMulti.cpp`:
```cpp
#include "filter_module.h"
#include "vital/VitalDescriptors.hpp"

namespace pg::modules {

const ModuleDescriptor& filterMulti() {
  static const pg::vitalmod::VitalModuleSpec spec{
    "filter.multi", "Filter", "filter",
    "Multi-model filter (analog, dirty, ladder, digital, diode, formant, comb, phaser). Cutoff in semitones.",
    "filter_1",
    [](pg::vitalmod::VitalModuleContext&) { return new vital::FilterModule("filter_1"); },
    [](vital::SynthModule& m) { static_cast<vital::FilterModule&>(m).setCreateOnValue(false); },
    nullptr, nullptr,
    {
      {"in", "In", vital::FilterModule::kAudio, pg::vitalmod::VitalPortKind::Audio, SignalRole::Audio, "Audio input"},
      {"reset", "Reset", vital::FilterModule::kReset, pg::vitalmod::VitalPortKind::Gate, SignalRole::Gate, "Gate: rising edge resets the filter state"},
      {"pitch", "Pitch", vital::FilterModule::kMidi, pg::vitalmod::VitalPortKind::PitchAsMidi, SignalRole::Pitch, "Pitch for key tracking (comb model)"},
      {"keytrack", "Key Track", vital::FilterModule::kKeytrack, pg::vitalmod::VitalPortKind::KeytrackOffset, SignalRole::Pitch, "Pitch offset for key tracking (semitones from middle C)"},
    },
    {{"out", "Out", 0, SignalRole::Audio, "Filtered audio"}},
    {},
    {"on", "osc1_input", "osc2_input", "osc3_input", "sample_input", "filter_input"},
    {},
    false, false, 0,
  };
  return pg::vitalmod::buildDescriptor(spec);
}

}  // namespace pg::modules
```
`KeytrackOffset` writes `pitchToMidiNote(pitch) − kMiddleCMidi` at `buffer[0]` (what `FilterModule::kKeytrack` expects); `ConstMidi` writes the raw note.

`builtin.cpp`: add `namespace modules { const ModuleDescriptor& filterMulti(); }` and register `r.add(modules::filterMulti())` (the function returns a reference to a process-lifetime descriptor).

- [ ] **Step 7: Run the tests** — `[vital]` tests pass, including `[rt]`.

- [ ] **Step 8: Commit** `feat(engine): Vital module adapter with generated descriptors; filter.multi`.

---

### Task 3: `osc.wavetable` and the wavetable bank

**Files:**
- Modify: `engine/src/modules/builtin.cpp`
- Create: `engine/src/vital/WavetableBank.hpp`, `engine/src/vital/WavetableBank.cpp`, `engine/src/modules/vital/OscWavetable.cpp`
- Modify: `engine/src/modules/builtin.cpp`
- Test: `engine/tests/test_wavetable_bank.cpp`, `engine/tests/test_vital_osc.cpp`

**Interfaces:**
- Consumes: `Module::configure(const ParamValues&)` and `VitalModuleSpec::{extraParams, onConfigure}` from Task 2.
- `pg::vitalmod::WavetableBank`: `static uint32_t numBuiltins()`, `static const char* builtinName(uint32_t)` (`"Basic Shapes"`, `"Sine"`, `"Saturated Sine"`, `"Triangle"`, `"Square"`, `"Pulse"`, `"Saw"`), `static void renderBuiltin(uint32_t index, vital::Wavetable&)`, `static Result loadJson(const nlohmann::json&, vital::Wavetable&)` (`.vitaltable` format via `WavetableCreator::jsonToState` + `render`), `static Result loadFile(const std::string& path, vital::Wavetable&)`.
- Module `osc.wavetable` (prefix `osc_1`): inputs `gate` (Gate → `kReset`), `retrigger` (Gate → `kRetrigger`), `pitch` (PitchAsMidi → `kMidi`), `voices` (ActiveVoices → `kActiveVoices`); outputs `out` (`kLevelled`), `raw` (`kRaw`); extra param `table` (enum of builtins, `kParamStructural`) prepended to the generated params; hidden `on`, `view_2d`, `destination`. `midi_track` default stays 1 (pitch follows the `pitch` input).

- [ ] **Step 1: Write the failing tests**

`engine/tests/test_wavetable_bank.cpp`:
```cpp
#include <catch2/catch_test_macros.hpp>
#include <nlohmann/json.hpp>
#include "vital/WavetableBank.hpp"
#include "wavetable.h"
#include "wavetable_creator.h"

TEST_CASE("WavetableBank renders builtins into a Wavetable", "[wavetable]") {
  vital::Wavetable table(vital::kNumOscillatorWaveFrames);
  REQUIRE(pg::vitalmod::WavetableBank::numBuiltins() == 7);
  REQUIRE(std::string(pg::vitalmod::WavetableBank::builtinName(1)) == "Sine");
  pg::vitalmod::WavetableBank::renderBuiltin(1, table);
  const vital::Wavetable::WavetableData* data = table.getAllActiveData();
  REQUIRE(data != nullptr);
  REQUIRE(data->num_frames >= 1);
  float peak = 0.f;
  for (int i = 0; i < vital::Wavetable::kWaveformSize; ++i) peak = std::max(peak, std::fabs(data->wave_data[0][i]));
  REQUIRE(peak > 0.5f);
}

TEST_CASE("WavetableBank loads the JSON that WavetableCreator writes", "[wavetable]") {
  vital::Wavetable source(vital::kNumOscillatorWaveFrames);
  WavetableCreator creator(&source);
  creator.init();
  creator.render();
  const nlohmann::json j = creator.stateToJson();
  vital::Wavetable target(vital::kNumOscillatorWaveFrames);
  REQUIRE(pg::vitalmod::WavetableBank::loadJson(j, target));
  REQUIRE(target.getAllActiveData()->num_frames == source.getAllActiveData()->num_frames);
  REQUIRE(pg::vitalmod::WavetableBank::loadJson(nlohmann::json::parse("{\"nope\":1}"), target).code == "E_SCHEMA");
}
```

`engine/tests/test_vital_osc.cpp`:
```cpp
#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <cmath>
#include <vector>
#include "core/Engine.hpp"
#include "modules/TestModules.hpp"
#include "modules/builtin.hpp"
#include "util/RtGuard.hpp"

namespace {
struct Rig {
  pg::Registry reg; pg::Engine engine{reg, pg::EngineConfig{48000.0, 64}}; pg::TransportSnapshot t;
  std::vector<float> l = std::vector<float>(64), r = std::vector<float>(64); float* out[2] = {l.data(), r.data()};
  Rig() { pg::registerBuiltinModules(reg); pg::test::registerTestModules(reg); }
  void render(int blocks) { for (int i = 0; i < blocks; ++i) engine.renderBlock(out, 2, 64, t); }
  // Frequency estimate of the last rendered block chain by zero-crossing count over `blocks` blocks.
  float measureHz(int blocks) {
    int crossings = 0; float prev = 0.f; bool first = true;
    for (int b = 0; b < blocks; ++b) { engine.renderBlock(out, 2, 64, t); for (float v : l) { if (!first && ((prev <= 0.f && v > 0.f) || (prev > 0.f && v <= 0.f))) ++crossings; prev = v; first = false; } }
    return static_cast<float>(crossings) / 2.f / (static_cast<float>(blocks * 64) / 48000.f);
  }
};
}  // namespace

TEST_CASE("osc.wavetable descriptor: table enum, generated params, ports", "[vital]") {
  Rig rig;
  const pg::RegisteredModule* o = rig.reg.find("osc.wavetable");
  REQUIRE(o != nullptr);
  REQUIRE(o->findInput("gate") == 0); REQUIRE(o->findInput("pitch") == 2);
  REQUIRE(o->findOutput("out") == 0); REQUIRE(o->findOutput("raw") == 1);
  const int32_t table = o->findParam("table");
  REQUIRE(table == 0);
  REQUIRE((o->desc->params[table].flags & pg::kParamStructural) != 0);
  REQUIRE(o->desc->params[table].enumCount == 7);
  REQUIRE(o->findParam("wave_frame") >= 0);
  REQUIRE(o->findParam("unison_voices") >= 0);
  REQUIRE(o->findParam("on") == -1);
  REQUIRE(o->findParam("view_2d") == -1);
}

TEST_CASE("osc.wavetable sine tracks the pitch input after a gate", "[vital]") {
  Rig rig;
  REQUIRE(rig.engine.model().addNode(rig.reg, {"gate", "test.const", {{"value", 1.f}}}));
  REQUIRE(rig.engine.model().addNode(rig.reg, {"pitch", "test.const", {{"value", 0.1f}}}));        // one octave up: 523.25 Hz
  REQUIRE(rig.engine.model().addNode(rig.reg, {"osc", "osc.wavetable", {{"table", 1.f}, {"unison_voices", 1.f}}}));
  REQUIRE(rig.engine.model().addNode(rig.reg, {"s", "test.sink"}));
  REQUIRE(rig.engine.model().addEdge(rig.reg, {"e1", "gate", "out", "osc", "gate"}));
  REQUIRE(rig.engine.model().addEdge(rig.reg, {"e2", "pitch", "out", "osc", "pitch"}));
  REQUIRE(rig.engine.model().addEdge(rig.reg, {"e3", "osc", "out", "s", "in"}));
  REQUIRE(rig.engine.commit());
  rig.render(20);
  const float hz = rig.measureHz(100);
  REQUIRE(hz == Catch::Approx(523.25f).epsilon(0.03f));
  REQUIRE(rig.engine.setParam("osc", "transpose", 12.f));   // +12 semitones
  rig.render(20);
  REQUIRE(rig.measureHz(100) == Catch::Approx(1046.5f).epsilon(0.03f));
}

TEST_CASE("osc.wavetable is allocation free in steady state", "[vital][rt]") {
  Rig rig;
  REQUIRE(rig.engine.model().addNode(rig.reg, {"gate", "test.const", {{"value", 1.f}}}));
  REQUIRE(rig.engine.model().addNode(rig.reg, {"osc", "osc.wavetable", {{"table", 2.f}}}));
  REQUIRE(rig.engine.model().addNode(rig.reg, {"s", "test.sink"}));
  REQUIRE(rig.engine.model().addEdge(rig.reg, {"e1", "gate", "out", "osc", "gate"}));
  REQUIRE(rig.engine.model().addEdge(rig.reg, {"e3", "osc", "out", "s", "in"}));
  REQUIRE(rig.engine.commit());
  rig.render(8);
  pg::test::resetRtViolations();
  { pg::test::RtScope scope; rig.render(200); }
  REQUIRE(pg::test::rtViolations() == 0);
}
```
If `SynthOscillator` allocates on its first pitch-bin change (it lazily fills FFT frames), extend the warm-up until steady state and record the number of warm-up blocks needed; do not weaken the assertion.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Write the bank**

`engine/src/vital/WavetableBank.hpp`:
```cpp
#pragma once
#include <cstdint>
#include <nlohmann/json.hpp>
#include <string>
#include "core/Result.hpp"
#include "wavetable.h"

namespace pg::vitalmod {
/// Builtin wavetables and .vitaltable JSON loading. Message thread only (renders allocate).
class WavetableBank {
public:
  static uint32_t numBuiltins();
  static const char* builtinName(uint32_t index);
  static void renderBuiltin(uint32_t index, vital::Wavetable& table);
  static Result loadJson(const nlohmann::json& j, vital::Wavetable& table);
  static Result loadFile(const std::string& path, vital::Wavetable& table);
};
}  // namespace pg::vitalmod
```

`engine/src/vital/WavetableBank.cpp`:
```cpp
#include "vital/WavetableBank.hpp"
#include <fstream>
#include "wave_frame.h"
#include "wave_source.h"
#include "wavetable_creator.h"
#include "wavetable_group.h"

namespace pg::vitalmod {
namespace {
const char* kNames[] = {"Basic Shapes", "Sine", "Saturated Sine", "Triangle", "Square", "Pulse", "Saw"};
const vital::PredefinedWaveFrames::Shape kShapes[] = {
  vital::PredefinedWaveFrames::kSin, vital::PredefinedWaveFrames::kSin, vital::PredefinedWaveFrames::kSaturatedSin,
  vital::PredefinedWaveFrames::kTriangle, vital::PredefinedWaveFrames::kSquare, vital::PredefinedWaveFrames::kPulse,
  vital::PredefinedWaveFrames::kSaw};
}  // namespace

uint32_t WavetableBank::numBuiltins() { return static_cast<uint32_t>(sizeof(kNames) / sizeof(kNames[0])); }
const char* WavetableBank::builtinName(uint32_t i) { return kNames[i < numBuiltins() ? i : 0]; }

void WavetableBank::renderBuiltin(uint32_t index, vital::Wavetable& table) {
  WavetableCreator creator(&table);
  creator.init();                                            // one group with an empty WaveSource
  if (index == 0) {                                          // Basic Shapes: sine -> triangle -> square -> saw across the table
    WaveSource* source = static_cast<WaveSource*>(creator.getGroup(0)->getComponent(0));
    const vital::PredefinedWaveFrames::Shape morph[] = {vital::PredefinedWaveFrames::kSin, vital::PredefinedWaveFrames::kTriangle,
                                                        vital::PredefinedWaveFrames::kSquare, vital::PredefinedWaveFrames::kSaw};
    const int last = vital::kNumOscillatorWaveFrames - 1;
    for (int i = 0; i < 4; ++i) {
      WaveSourceKeyframe* frame = static_cast<WaveSourceKeyframe*>(source->insertNewKeyframe(i * last / 3));
      frame->getWaveFrame()->copy(vital::PredefinedWaveFrames::getWaveFrame(morph[i]));
    }
  } else {
    WaveSource* source = static_cast<WaveSource*>(creator.getGroup(0)->getComponent(0));
    WaveSourceKeyframe* frame = static_cast<WaveSourceKeyframe*>(source->insertNewKeyframe(0));
    frame->getWaveFrame()->copy(vital::PredefinedWaveFrames::getWaveFrame(kShapes[index < numBuiltins() ? index : 0]));
  }
  creator.setName(kNames[index < numBuiltins() ? index : 0]);
  creator.render();
}

Result WavetableBank::loadJson(const nlohmann::json& j, vital::Wavetable& table) {
  if (!WavetableCreator::isValidJson(j)) return Result::fail("E_SCHEMA", "not a wavetable JSON document");
  WavetableCreator creator(&table);
  creator.jsonToState(j);
  creator.render();
  return {};
}

Result WavetableBank::loadFile(const std::string& path, vital::Wavetable& table) {
  std::ifstream in(path);
  if (!in) return Result::fail("E_IO", "cannot open " + path);
  nlohmann::json j = nlohmann::json::parse(in, nullptr, false);
  if (j.is_discarded()) return Result::fail("E_SCHEMA", "invalid JSON in " + path);
  return loadJson(j, table);
}

}  // namespace pg::vitalmod
```
Names to verify against the vendored headers: `WavetableCreator::init()`, `getGroup(int)`, `WavetableGroup::getComponent(int)`, `WaveSource::insertNewKeyframe(int)`, `WaveSourceKeyframe::getWaveFrame()`, `WaveFrame::copy(const WaveFrame*)`, `PredefinedWaveFrames::getWaveFrame(Shape)`, `WavetableCreator::isValidJson(json)`. Follow the headers if a name differs and record it. If `init()` does not create a group, add one with `addGroup(new WavetableGroup())` + `group->addComponent(new WaveSource())`.

- [ ] **Step 4: Spec for `osc.wavetable`**

`engine/src/modules/vital/OscWavetable.cpp`:
```cpp
#include "oscillator_module.h"
#include "vital/VitalDescriptors.hpp"
#include "vital/WavetableBank.hpp"

namespace pg::modules {

const ModuleDescriptor& oscWavetable() {
  using namespace pg::vitalmod;
  static std::vector<const char*> tableNames = [] { std::vector<const char*> v; for (uint32_t i = 0; i < WavetableBank::numBuiltins(); ++i) v.push_back(WavetableBank::builtinName(i)); return v; }();
  static const VitalModuleSpec spec{
    "osc.wavetable", "Wavetable Oscillator", "osc",
    "Wavetable oscillator with unison, spectral morphing and phase distortion. Pitch input in phasegrid pitch units.",
    "osc_1",
    [](VitalModuleContext&) { return new vital::OscillatorModule("osc_1"); },
    nullptr, nullptr, nullptr,
    {
      {"gate", "Gate", vital::OscillatorModule::kReset, VitalPortKind::Gate, SignalRole::Gate, "Rising edge resets the oscillator phase"},
      {"retrigger", "Retrigger", vital::OscillatorModule::kRetrigger, VitalPortKind::Gate, SignalRole::Gate, "Rising edge retriggers without full reset"},
      {"pitch", "Pitch", vital::OscillatorModule::kMidi, VitalPortKind::PitchAsMidi, SignalRole::Pitch, "Pitch (0.1 per octave from middle C)"},
      {"voices", "Voices", vital::OscillatorModule::kActiveVoices, VitalPortKind::ActiveVoices, SignalRole::Cv, "Active voice lanes (internal)"},
    },
    {{"out", "Out", vital::OscillatorModule::kLevelled, SignalRole::Audio, "Audio after level and pan"},
     {"raw", "Raw", vital::OscillatorModule::kRaw, SignalRole::Audio, "Audio before level and pan"}},
    {},
    {"on", "view_2d", "destination"},
    {},
    false, false, 0,
  };
  static VitalModuleSpec withTable = [] {
    VitalModuleSpec s = spec;
    s.extraParams.push_back(ParamDesc{"table", "Wavetable", 0.f, static_cast<float>(tableNames.size() - 1), 0.f, ParamUnit::None, ParamCurve::Linear,
                                      kParamEnum | kParamInteger | kParamNoSmooth | kParamStructural, tableNames.data(),
                                      static_cast<uint32_t>(tableNames.size()), "select", nullptr, "Built-in wavetable"});
    s.onConfigure = [](vital::SynthModule& m, const ParamValues& values) {
      auto it = values.find("table");
      const uint32_t index = it == values.end() ? 0u : static_cast<uint32_t>(it->second);
      WavetableBank::renderBuiltin(index, *static_cast<vital::OscillatorModule&>(m).getWavetable());
    };
    return s;
  }();
  return buildDescriptor(withTable);
}

}  // namespace pg::modules
```
`extraParams` are emitted before the generated params (so `table` is param 0) and have no Vital control (the adapter skips them); `onConfigure` receives the values stored by `Module::configure`. `midi_track`'s generated default is already 1.0.

- [ ] **Step 5: Register, run, commit** — `builtin.cpp` adds `oscWavetable()`; `npm run engine:test` passes; commit `feat(engine): osc.wavetable with builtin wavetable bank and .vitaltable loading`.

---

### Task 4: `env.dahdsr` and `note.toCv`

**Files:**
- Create: `engine/src/modules/vital/EnvDahdsr.cpp`, `engine/src/modules/NoteToCv.cpp`
- Modify: `engine/src/modules/builtin.cpp`
- Test: `engine/tests/test_vital_env.cpp`, `engine/tests/test_note_to_cv.cpp`

**Interfaces:**
- `env.dahdsr` (prefix `env_1`, `EnvelopeModule("env_1", /*force_audio_rate*/ true)`): input `gate` (Gate → `kTrigger`); outputs `out` (`kValue`), `phase` (`kPhase`); params generated (`delay, attack, hold, decay, sustain, release, attack_power, decay_power, release_power`).
- `note.toCv`: input `notes` (Event); outputs `pitch`, `gate`, `velocity` (continuous, all lanes of voice 0; voice 1 lanes zero); param `mode` enum {`last`, `low`, `high`} (`kParamNoSmooth`), `glide` [0, 1] s (`kParamModulatable`). Monophonic last-note priority with a held-note stack (max 16); gate stays high while any note is held; retrigger on each NoteOn (gate dips to 0 for one sample when a new note arrives while held, so envelopes retrigger). Pitch = `midiNoteToPitch(note)` glided with a one-pole of `glide` seconds.

- [ ] **Step 1: Write the failing tests**

`engine/tests/test_note_to_cv.cpp`:
```cpp
#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include "util/GraphFixture.hpp"
#include "modules/builtin.hpp"

namespace {
// test module emitting NoteOn/NoteOff at fixed frames (registered locally)
struct NoteGen : pg::VoicedModule<int> {
  static inline std::vector<pg::Event> script;   // frames relative to block 0; one block only
  static inline int block = 0;
  void process(pg::ProcessContext& c) override {
    if (block++ != 0) return;
    for (const pg::Event& e : script) c.eventOut(0).push(e);
  }
};
const pg::PortDesc kOut[] = {{"notes", "Notes", pg::PortKind::Event, 0, pg::SignalRole::Any, ""}};
const pg::ModuleDescriptor kNoteGen{pg::kModuleAbiVersion, "test.noteGen", "NoteGen", "test", "", nullptr, 0, kOut, 1, nullptr, 0, 0, 0, [] () -> pg::Module* { return new NoteGen(); }};
}  // namespace

TEST_CASE("note.toCv: last-note priority, gate, velocity, retrigger dip", "[modules]") {
  pg::test::GraphFixture f;
  pg::registerBuiltinModules(f.reg);
  REQUIRE_FALSE(f.reg.add(kNoteGen).has_value());
  NoteGen::block = 0;
  NoteGen::script = {
    pg::Event{.frame = 2, .type = pg::EventType::NoteOn, .a = 60.f, .b = 0.5f},
    pg::Event{.frame = 10, .type = pg::EventType::NoteOn, .a = 72.f, .b = 1.0f},
    pg::Event{.frame = 20, .type = pg::EventType::NoteOff, .a = 72.f},
    pg::Event{.frame = 30, .type = pg::EventType::NoteOff, .a = 60.f},
  };
  f.node("gen", "test.noteGen");
  f.node("cv", "note.toCv", {{"glide", 0.f}});
  f.edge("e", "gen.notes", "cv.notes");
  auto p = f.compile();
  f.run(*p, 64);
  REQUIRE(f.out(*p, "cv", "gate", 1) == 0.f);
  REQUIRE(f.out(*p, "cv", "gate", 2) == 1.f);
  REQUIRE(f.out(*p, "cv", "pitch", 2) == Catch::Approx(0.f));            // 60 -> 0
  REQUIRE(f.out(*p, "cv", "velocity", 2) == Catch::Approx(0.5f));
  REQUIRE(f.out(*p, "cv", "gate", 10) == 0.f);                            // retrigger dip
  REQUIRE(f.out(*p, "cv", "gate", 11) == 1.f);
  REQUIRE(f.out(*p, "cv", "pitch", 11) == Catch::Approx(0.1f));           // 72 -> +1 octave
  REQUIRE(f.out(*p, "cv", "pitch", 21) == Catch::Approx(0.f));            // back to held 60
  REQUIRE(f.out(*p, "cv", "gate", 21) == 1.f);
  REQUIRE(f.out(*p, "cv", "gate", 31) == 0.f);
  REQUIRE(f.out(*p, "cv", "gate", 2, 2) == 0.f);                          // voice 1 lanes silent
}
```

`engine/tests/test_vital_env.cpp`:
```cpp
#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include "util/GraphFixture.hpp"
#include "modules/builtin.hpp"

TEST_CASE("env.dahdsr rises on gate and releases on gate off", "[vital]") {
  pg::test::GraphFixture f;
  pg::registerBuiltinModules(f.reg);
  f.node("g", "test.const", {{"value", 1.f}});
  f.node("env", "env.dahdsr", {{"attack", 0.f}, {"decay", 0.f}, {"sustain", 1.f}, {"release", 0.f}, {"delay", 0.f}, {"hold", 0.f}});
  f.edge("e", "g.out", "env.gate");
  auto p = f.compile();
  f.run(*p, 64);
  REQUIRE(f.out(*p, "env", "out", 63) == Catch::Approx(1.f).margin(0.05f));
  REQUIRE(f.model.setParam(f.reg, "g", "value", 0.f));
  auto p2 = f.compile();                 // same instances; knob change flows through ParamState on the next run
  for (int i = 0; i < 4; ++i) f.run(*p2, 64);
  REQUIRE(f.out(*p2, "env", "out", 63) == Catch::Approx(0.f).margin(0.05f));
}
```
(`GraphFixture` compiles without an Engine, so param changes are applied by re-acquire only for new instances; here the *gate* module `g` is `test.const` whose knob is read from `ParamState` set at creation — so instead of `setParam` + recompile, drive the gate with a second `test.const` node and an edge swap: remove edge `e`, add `e2` from a `test.const(0)` node, recompile, run. Write the test that way.)

- [ ] **Step 2: Implement `env.dahdsr` spec** (`EnvDahdsr.cpp`): prefix `env_1`, `create = [](VitalModuleContext&) { return new vital::EnvelopeModule("env_1", true); }`, inputs `{"gate", "Gate", vital::EnvelopeModule::kTrigger, Gate, Gate, "..."}`, outputs `out` (`kValue`), `phase` (`kPhase`), no hidden controls, `needsBeatsPerSecond=false`. Note `EnvelopeModule::init()` does not call `SynthModule::init()`; the adapter's generic path is unaffected.

- [ ] **Step 3: Implement `note.toCv`** (`NoteToCv.cpp`), own module (no Vital):
```cpp
struct State { std::array<uint8_t, 16> held{}; uint32_t heldCount = 0; float currentNote = 60.f; float targetNote = 60.f; float velocity = 0.f; bool gate = false; float glideCoeff = 0.f; };
// process: walk events in frame order; for each frame i: apply events at i (NoteOn: push note, set target/velocity, gate=true,
// dipThisFrame=true if already gated; NoteOff: remove note, if stack empty gate=false else target = policy(stack));
// write pitch = midiNoteToPitch(current) with glide, gate = (gate && !dip) ? 1 : 0, velocity; all on voice 0 lanes only (& lanes::voice(0)).
```
Params: `mode` enum (`last`, `low`, `high`), `glide` [0,1] s Linear modulatable. Glide coefficient computed per block from `glide` seconds (`exp(-1/(glide*sr))`, 0 → instant).

- [ ] **Step 4: Register, run, commit** — `feat(engine): env.dahdsr and note.toCv`.

---

### Task 5: `mod.lfo` and `mod.random`

**Files:**
- Create: `engine/src/modules/vital/ModLfo.cpp`, `engine/src/modules/vital/ModRandom.cpp`
- Modify: `engine/src/modules/builtin.cpp`
- Test: `engine/tests/test_vital_lfo.cpp`

**Interfaces:**
- `mod.lfo` (prefix `lfo_1`): `create = [](VitalModuleContext& ctx) { return new vital::LfoModule("lfo_1", &ctx.lineGenerator(), ctx.beatsPerSecond()); }` (the context owns the `LineGenerator` and beats-per-second output per instance). Inputs: `gate` (Gate → `kNoteTrigger`), `pitch` (PitchAsMidi → `kMidi`), `count` (NoteCount → `kNoteCount`); outputs `out` (`kValue`), `phase` (`kOscPhase`), `frequency` (`kOscFrequency`); `configure`: `setControlRate(false)` so outputs are audio-rate; extra structural param `shape` enum {`sine`, `triangle`, `square`, `saw_up`, `saw_down`} → `onConfigure` calls `initSin/initTriangle/initSquare/initSawUp/initSawDown` + `render()` on the instance's `LineGenerator`; `needsBeatsPerSecond = true`; hidden `sync` (not a parameter anyway).
- `mod.random` (prefix `random_1`): inputs `gate` (Gate → `kNoteTrigger`), `pitch` (PitchAsMidi → `kMidi`); output `out`; `configure`: `setControlRate(false)`; `needsBeatsPerSecond = true`.

- [ ] **Step 1: Write the failing test**

`engine/tests/test_vital_lfo.cpp`:
```cpp
#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <cmath>
#include "util/GraphFixture.hpp"
#include "modules/builtin.hpp"

TEST_CASE("mod.lfo sine at 4 Hz in seconds mode spans -1..1 with the expected period", "[vital]") {
  pg::test::GraphFixture f;
  pg::registerBuiltinModules(f.reg);
  f.node("g", "test.const", {{"value", 1.f}});
  // frequency param is exponential in Vital: value v -> 2^v Hz; 2 -> 4 Hz. sync 0 = seconds ("frequency" ValueDetails: -7..9)
  f.node("lfo", "mod.lfo", {{"shape", 0.f}, {"frequency", 2.f}, {"sync", 0.f}, {"sync_type", 0.f}});
  f.edge("e", "g.out", "lfo.gate");
  auto p = f.compile();
  float minV = 1.f, maxV = -1.f; int crossings = 0; float prev = 0.f;
  for (int b = 0; b < 750; ++b) {   // 1 second at 48 kHz / 64
    f.run(*p, 64);
    for (uint32_t i = 0; i < 64; ++i) { const float v = f.out(*p, "lfo", "out", i); minV = std::min(minV, v); maxV = std::max(maxV, v); if (b > 0 && ((prev < 0.f && v >= 0.f))) ++crossings; prev = v; }
  }
  REQUIRE(maxV > 0.9f);
  REQUIRE(minV < -0.9f);
  REQUIRE(crossings == Catch::Approx(4).margin(1));
}
```
If Vital's LFO output range is 0..1 (unipolar), assert `maxV > 0.9f && minV < 0.1f` instead and note it in the descriptor doc; the amendment leaves LFO polarity to the module.

- [ ] **Step 2: Implement** the two spec files (`onConfigure` for `mod.lfo` maps the `shape` enum to `LineGenerator::initSin/initTriangle/initSquare/initSawUp/initSawDown` followed by `render()`; `configure` calls `setControlRate(false)` on both).

- [ ] **Step 3: Register, run, commit** — `feat(engine): mod.lfo and mod.random`.

---

### Task 6: The eight effects (`processWithInput` family)

**Files:**
- Create: `engine/src/modules/vital/FxReverb.cpp`, `FxDelay.cpp`, `FxChorus.cpp`, `FxFlanger.cpp`, `FxPhaser.cpp`, `FxDistortion.cpp`, `FxCompressor.cpp`, `FxEq.cpp`
- Modify: `engine/src/modules/builtin.cpp`
- Test: `engine/tests/test_vital_effects.cpp`

**Interfaces:**
All eight share one shape: `processWithInput = true`, input 0 = `{"in", "In", -1, Audio, Audio, "Audio input"}` (no Vital input index; the adapter passes the buffer to `processWithInput`), output 0 = `{"out", "Out", 0, Audio, "Processed audio"}`, no hidden `on` (effects are always on; bypass = unplug), prefix `""` (fixed control ids). Per module:

| Module id | Vital class | `needsBeatsPerSecond` | Extra outputs | Notes |
|---|---|---|---|---|
| `fx.reverb` | `ReverbModule()` | no | — | `setSampleRate` is overridden by the module; the adapter already calls it after `init()` |
| `fx.delay` | `DelayModule(bps)` | yes | — | hidden: none (`delay_sync`/`delay_aux_sync` are not parameters, skipped automatically) |
| `fx.chorus` | `ChorusModule(bps)` | yes | — (its 4 status outputs are not exposed) | `clone()` asserts; never cloned by us |
| `fx.flanger` | `FlangerModule(bps)` | yes | `frequency` (`kFrequencyOutput`, control-rate → broadcast) | |
| `fx.phaser` | `PhaserModule(bps)` | yes | `cutoff` (`kCutoffOutput`) | |
| `fx.distortion` | `DistortionModule()` | no | — | |
| `fx.compressor` | `CompressorModule()` | no | `low_in`, `band_in`, `high_in`, `low_out`, `band_out`, `high_out` (mean-squared readouts, outputs 1..6) | hidden `low_band_unused` |
| `fx.eq` | `EqualizerModule()` | no | — | |

Effects with tempo-synced controls read the adapter's beats-per-second `cr::Output` (tempo/60 from `TransportSnapshot`). The `_sync` `cr::Value`s created by `createTempoSyncSwitch` are not `Parameters`, so they are skipped by descriptor generation; expose them explicitly as extra enum params `sync` / `aux_sync` (labels from `strings::kFrequencySyncNames`, `kParamEnum|kParamInteger|kParamNoSmooth`) whose knob binding targets the control named `<name>_sync` — add `VitalControlOverride::exposeNonParameter = true` support in `buildDescriptor`: when set, a control missing from `Parameters` is still emitted using the override's `min/max/def/labels`. Also the `delay_tempo` etc. `kIndexed` params keep their `kSyncedFrequencyNames` labels (generated).

- [ ] **Step 1: Write the failing tests**

`engine/tests/test_vital_effects.cpp`:
```cpp
#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <cmath>
#include "util/GraphFixture.hpp"
#include "util/RtGuard.hpp"
#include "modules/builtin.hpp"

namespace {
const char* kEffects[] = {"fx.reverb", "fx.delay", "fx.chorus", "fx.flanger", "fx.phaser", "fx.distortion", "fx.compressor", "fx.eq"};
float rms(pg::test::GraphFixture& f, pg::Program& p, const char* node, int blocks) {
  double s = 0; int n = 0;
  for (int b = 0; b < blocks; ++b) { f.run(p, 64); for (uint32_t i = 0; i < 64; ++i) { const float v = f.out(p, node, "out", i); s += v * v; ++n; } }
  return static_cast<float>(std::sqrt(s / n));
}
}  // namespace

TEST_CASE("every effect registers, passes audio, and is allocation free", "[vital][rt]") {
  for (const char* id : kEffects) {
    DYNAMIC_SECTION(id) {
      pg::test::GraphFixture f;
      pg::registerBuiltinModules(f.reg);
      const pg::RegisteredModule* m = f.reg.find(id);
      REQUIRE(m != nullptr);
      REQUIRE(m->findInput("in") == 0);
      REQUIRE(m->findOutput("out") == 0);
      REQUIRE(m->findParam("on") == -1);
      f.node("x", "test.impulse");
      f.node("fx", id);
      f.edge("e", "x.out", "fx.in");
      auto p = f.compile();
      f.run(*p, 64);                                   // impulse in block 0
      float energy = 0.f;
      for (int b = 0; b < 200; ++b) { f.run(*p, 64); for (uint32_t i = 0; i < 64; ++i) energy += std::fabs(f.out(*p, "fx", "out", i)); }
      // Time-varying effects (reverb/delay/chorus/flanger) spread the impulse; static ones (distortion/compressor/eq/phaser) pass it in block 0.
      float block0 = 0.f; for (uint32_t i = 0; i < 64; ++i) block0 += std::fabs(f.out(*p, "fx", "out", i));
      REQUIRE(energy + block0 > 0.f);
      pg::test::resetRtViolations();
      { pg::test::RtScope scope; for (int b = 0; b < 100; ++b) f.run(*p, 64); }
      REQUIRE(pg::test::rtViolations() == 0);
    }
  }
}

TEST_CASE("fx.delay repeats an impulse after the delay time", "[vital]") {
  pg::test::GraphFixture f;
  pg::registerBuiltinModules(f.reg);
  f.node("x", "test.impulse");
  // delay_sync 0 = seconds; delay_frequency is exponential 2^v Hz: v = 3 -> 8 Hz -> 125 ms -> 6000 samples ~ block 93
  f.node("d", "fx.delay", {{"sync", 0.f}, {"frequency", 3.f}, {"feedback", 0.f}, {"dry_wet", 1.f}, {"style", 0.f}});
  f.edge("e", "x.out", "d.in");
  auto p = f.compile();
  int loudestBlock = -1; float loudest = 0.f;
  for (int b = 0; b < 200; ++b) {
    f.run(*p, 64);
    float e = 0.f; for (uint32_t i = 0; i < 64; ++i) e += std::fabs(f.out(*p, "d", "out", i));
    if (b > 0 && e > loudest) { loudest = e; loudestBlock = b; }
  }
  REQUIRE(loudest > 0.f);
  REQUIRE(loudestBlock == Catch::Approx(93).margin(3));
}
```
The Vital `delay_frequency` control is `kExponential` with `display_invert`; if the measured echo lands at a different block, compute the expected block from Vital's `DelayModule` semantics (frequency v → period `1 / 2^v` s) and fix the test's expectation with a comment, not the module.

- [ ] **Step 2: Implement** one spec file per effect (pattern below for `fx.delay`; the others differ only in class, `needsBeatsPerSecond`, extra outputs and hidden lists):
```cpp
#include "delay_module.h"
#include "synth_strings.h"
#include "vital/VitalDescriptors.hpp"

namespace pg::modules {
const ModuleDescriptor& fxDelay() {
  using namespace pg::vitalmod;
  static const VitalModuleSpec spec = [] {
    VitalModuleSpec s;
    s.id = "fx.delay"; s.name = "Delay"; s.category = "fx"; s.doc = "Stereo/ping-pong delay with filtered feedback.";
    s.prefix = "delay";
    s.create = [](VitalModuleContext& ctx) { return new vital::DelayModule(ctx.beatsPerSecond()); };
    s.inputs = {{"in", "In", -1, VitalPortKind::Audio, SignalRole::Audio, "Audio input"}};
    s.outputs = {{"out", "Out", 0, SignalRole::Audio, "Delayed audio"}};
    s.processWithInput = true; s.needsBeatsPerSecond = true;
    s.overrides = {
      {"sync", pg::kParamEnum | pg::kParamInteger | pg::kParamNoSmooth, "Time mode", /*exposeNonParameter*/ true, 0.f, 3.f, 1.f, strings::kFrequencySyncNames, 4},
      {"aux_sync", pg::kParamEnum | pg::kParamInteger | pg::kParamNoSmooth, "Time mode 2", true, 0.f, 3.f, 1.f, strings::kFrequencySyncNames, 4},
    };
    return s;
  }();
  return buildDescriptor(spec);
}
}  // namespace pg::modules
```
`buildDescriptor` (Task 2) must honour `exposeNonParameter` overrides: a control missing from `vital::Parameters` is still emitted with the override's range and labels (enum if `labels`); copy `.c_str()` pointers of the `synth_strings.h` tables into the built descriptor's stable storage. Implement that support in this task if Task 2 left it out.

- [ ] **Step 3: Register all eight, run, commit** — `feat(engine): eight Vital-backed effects`.

---

### Task 7: `sampler.player` and the sample bank

**Files:**
- Create: `engine/src/vital/SampleBank.hpp`, `engine/src/vital/SampleBank.cpp`, `engine/src/modules/vital/SamplerPlayer.cpp`
- Modify: `engine/src/modules/builtin.cpp`
- Test: `engine/tests/test_sampler.cpp`, `engine/tests/golden/click.wav` (generated by the test itself on first run into a temp dir, not committed)

**Interfaces:**
- `pg::vitalmod::SampleBank::loadWav(const std::string& path, vital::Sample& into) -> Result` (miniaudio `ma_decoder` to f32, mono or stereo, calls `loadSample` on the message thread; fails with `E_IO`/`E_FORMAT`).
- `sampler.player` (no prefix; `SampleModule()`): inputs `gate` (Gate → `kReset`), `pitch` (PitchAsMidi → `kMidi`), `count` (NoteCount → `kNoteCount`); outputs `out` (`kLevelled`), `raw` (`kRaw`); hidden `on`, `destination`; `postInit = [](vital::SynthModule& m) { m.getControls()["sample_on"]->set(1.0f); }`. Default content is Vital's white noise until an asset is loaded; `VitalModuleContext` exposes `vital::Sample* sample()` for the future `module.setAsset` path (spec §E.4).

- [ ] **Step 1: Write the failing test**

`engine/tests/test_sampler.cpp`:
```cpp
#include <catch2/catch_test_macros.hpp>
#include <filesystem>
#include <vector>
#include "render/OfflineRenderer.hpp"
#include "util/GraphFixture.hpp"
#include "vital/SampleBank.hpp"
#include "modules/builtin.hpp"
#include "sample_source.h"

TEST_CASE("SampleBank decodes a WAV into a vital::Sample", "[sampler]") {
  const std::string path = (std::filesystem::temp_directory_path() / "pg_click.wav").string();
  std::vector<float> click(4800 * 2, 0.f); click[0] = click[1] = 1.f;   // stereo, 100 ms
  std::string err; REQUIRE(pg::writeWav(path, click, 2, 48000.0, err));
  vital::Sample sample;
  REQUIRE(pg::vitalmod::SampleBank::loadWav(path, sample));
  REQUIRE(sample.originalLength() == 4800);
  REQUIRE(pg::vitalmod::SampleBank::loadWav("/nonexistent.wav", sample).code == "E_IO");
}

TEST_CASE("sampler.player plays on gate and is allocation free", "[sampler][rt]") {
  pg::test::GraphFixture f;
  pg::registerBuiltinModules(f.reg);
  f.node("g", "test.const", {{"value", 1.f}});
  f.node("smp", "sampler.player");
  f.edge("e", "g.out", "smp.gate");
  auto p = f.compile();
  float energy = 0.f;
  for (int b = 0; b < 20; ++b) { f.run(*p, 64); for (uint32_t i = 0; i < 64; ++i) energy += std::fabs(f.out(*p, "smp", "out", i)); }
  REQUIRE(energy > 0.f);                                   // default white-noise sample plays
  pg::test::resetRtViolations();
  { pg::test::RtScope scope; for (int b = 0; b < 100; ++b) f.run(*p, 64); }
  REQUIRE(pg::test::rtViolations() == 0);
}
```
`vital::Sample::originalLength()` — use whatever accessor the vendored `sample_source.h` provides for the loaded length (e.g. `getData()->length`); follow the header.

- [ ] **Step 2: Implement** `SampleBank::loadWav` with `ma_decoder_init_file` (`ma_decoder_config_init(ma_format_f32, 0, 0)`), read all frames into a vector, de-interleave, call `sample.loadSample(left, right, frames, rate)` (or the mono overload), `ma_decoder_uninit`. Then the `sampler.player` spec.

- [ ] **Step 3: Register, run, commit** — `feat(engine): sampler.player with WAV sample bank`.

---

### Task 8: Own utility modules: `phase.clock`, `math.scaleOffset`, `mix.mixer`, `amp.vca`

**Files:**
- Create: `engine/src/modules/PhaseClock.cpp`, `engine/src/modules/ScaleOffset.cpp`, `engine/src/modules/Mixer.cpp`, `engine/src/modules/Vca.cpp`
- Modify: `engine/src/modules/builtin.cpp`
- Test: `engine/tests/test_utility_modules.cpp`

**Interfaces:**
- `phase.clock` (`kModuleNeedsTransport`): outputs `phase` (0..1 ramp), `trigger` (1 for one sample at each wrap); params `division` enum {`1/16`, `1/8`, `1/4`, `1/2`, `1 bar`, `2 bars`, `4 bars`} (`kParamNoSmooth`), `swing` [0, 0.5] modulatable. Phase derives from `transport.ppq` (quarter notes): `beats = ppq / quartersPerDivision`, `phase = frac(beats)` when `playing`, else free-runs from `samplePos` at `tempo`. Swing delays every second cycle by `swing * cycle`.
- `math.scaleOffset`: input `in`; output `out`; params `scale` [-4, 4] def 1, `offset` [-1, 1] def 0, both modulatable. `out = in * scale + offset` lane-wise.
- `mix.mixer`: inputs `in1..in4`; output `out`; params `level1..level4` [0, 2] def 1 modulatable. Unconnected inputs read silence.
- `amp.vca`: inputs `in`, `gain`; output `out`; params `gain` [0, 2] def 1 modulatable, `curve` enum {`linear`, `exponential`}. `out = in * (gainSignal + gainKnob)`, exponential applies `x²` to the sum, clamped at 0.

- [ ] **Step 1: Write the failing tests**

`engine/tests/test_utility_modules.cpp`:
```cpp
#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include "util/GraphFixture.hpp"
#include "modules/builtin.hpp"

TEST_CASE("math.scaleOffset and mix.mixer arithmetic", "[modules]") {
  pg::test::GraphFixture f; pg::registerBuiltinModules(f.reg);
  f.node("a", "test.const", {{"value", 0.25f}}); f.node("b", "test.const", {{"value", 0.5f}});
  f.node("so", "math.scaleOffset", {{"scale", 2.f}, {"offset", 0.1f}});
  f.node("mx", "mix.mixer", {{"level1", 1.f}, {"level2", 0.5f}});
  f.edge("e1", "a.out", "so.in"); f.edge("e2", "so.out", "mx.in1"); f.edge("e3", "b.out", "mx.in2");
  auto p = f.compile(); f.run(*p, 64);
  REQUIRE(f.out(*p, "so", "out", 5) == Catch::Approx(0.6f));
  REQUIRE(f.out(*p, "mx", "out", 5) == Catch::Approx(0.6f + 0.25f));
}

TEST_CASE("amp.vca multiplies by gain signal plus knob", "[modules]") {
  pg::test::GraphFixture f; pg::registerBuiltinModules(f.reg);
  f.node("a", "test.const", {{"value", 0.5f}}); f.node("g", "test.const", {{"value", 0.5f}});
  f.node("vca", "amp.vca", {{"gain", 0.f}, {"curve", 0.f}});
  f.edge("e1", "a.out", "vca.in"); f.edge("e2", "g.out", "vca.gain");
  auto p = f.compile(); f.run(*p, 64);
  REQUIRE(f.out(*p, "vca", "out", 0) == Catch::Approx(0.25f));
}

TEST_CASE("phase.clock ramps with the transport and fires a trigger at each wrap", "[modules]") {
  pg::test::GraphFixture f; pg::registerBuiltinModules(f.reg);
  f.node("clk", "phase.clock", {{"division", 2.f}});   // 1/4 note
  auto p = f.compile();
  f.transport.playing = true; f.transport.tempo = 120.0;  // one quarter = 0.5 s = 24000 samples
  float lastPhase = -1.f; int triggers = 0;
  for (int b = 0; b < 750; ++b) {                          // 48000 samples = 2 quarters
    f.transport.ppq = (b * 64) / 24000.0; f.transport.samplePos = static_cast<uint64_t>(b) * 64;
    f.run(*p, 64);
    for (uint32_t i = 0; i < 64; ++i) { const float ph = f.out(*p, "clk", "phase", i); REQUIRE(ph >= 0.f); REQUIRE(ph < 1.f); if (f.out(*p, "clk", "trigger", i) > 0.f) ++triggers; lastPhase = ph; }
  }
  REQUIRE(triggers == 2);
  REQUIRE(lastPhase == Catch::Approx(1.f).margin(0.01f));
}
```

- [ ] **Step 2: Implement the four modules** following `docs/adding-a-module.md` (one file each, `VoicedModule<State>`, static descriptor arrays). `phase.clock` keeps `lastPhase` in state to detect wraps; per-sample phase = `frac((ppq + i / samplesPerQuarter) / quartersPerDivision + swingOffset)`.

- [ ] **Step 3: Register, run, commit** — `feat(engine): phase.clock, math.scaleOffset, mix.mixer, amp.vca`.

---

### Task 9: `--catalog`, golden synth render, docs

**Files:**
- Create: `engine/src/services/Catalog.hpp`, `engine/src/services/Catalog.cpp`, `engine/tests/golden/synth_voice.json`, `engine/tests/test_catalog.cpp`, `engine/tests/test_golden_synth.cpp`
- Modify: `engine/src/app/main.cpp`, `docs/engine.md`, `docs/adding-a-module.md`, `shared/protocol/catalog.ts` (new), `shared/protocol/catalog.test.ts` (new)

**Interfaces:**
- `nlohmann::json pg::catalogJson(const Registry&)`: `{ "catalogHash": "<fnv1a hex of descriptor bytes>", "conventions": {"octavesPerUnit":10, "middleCHz":261.6256, "gateThreshold":0, "blockSize":128, "lanes":["v0.L","v0.R","v1.L","v1.R"]}, "modules": [ { id, name, category, doc, flags, inputs:[{id,name,kind:"continuous"|"event",role,doc,implicit:bool,param?}], outputs:[...], params:[{id,name,min,max,default,unit,curve,flags:{modulatable,integer,enum,hidden,noSmooth,structural},enumLabels?,uiWidget,group?,doc}] } ] }` sorted by module id.
- CLI `phasegrid-engine --catalog` prints it.
- `shared/protocol/catalog.ts`: zod schemas `PortDescSchema`, `ParamDescSchema`, `ModuleDescriptorSchema`, `CatalogSchema` matching the JSON; a vitest that parses `engine/tests/golden/catalog.json` (written by `--catalog` and committed) with `CatalogSchema`.
- Golden patch `synth_voice.json`: `test.noteGen`-free version using `test.const` gates: `gate(test.const 1) → osc.wavetable.gate`, `pitch(test.const 0) → osc.pitch`, `osc.out → filter.multi.in`, `filter.out → amp.vca.in`, `gate → env.dahdsr.gate`, `env.out → amp.vca.gain`, `vca.out → io.audioOut.inL/inR`; rendered for 1 s the output must be non-silent and its spectrum must show more energy below 1 kHz than above 8 kHz (a 12 dB low-pass at MIDI 83).

- [ ] **Step 1: Tests first** (`test_catalog.cpp`: every registered module appears, `filter.multi` has an implicit `param:cutoff` input with `implicit:true` and `param:"cutoff"`, hash is 16 hex chars and stable across two calls; `test_golden_synth.cpp`: load `golden/synth_voice.json`, render 1 s via `renderInterleaved`, RMS > 0.01, band-energy ratio > 10 using the 40-line radix-2 FFT in `tests/util/Fft.hpp` (write it: real input, power of two, returns magnitudes)).
- [ ] **Step 2: Implement `Catalog.cpp`**, `--catalog` in `main.cpp` (registers builtin modules only), write `engine/tests/golden/catalog.json` by running the CLI and commit it; `shared/protocol/catalog.ts` + vitest.
- [ ] **Step 3: Docs** — `docs/engine.md` gains "Vital-backed modules" (adapter contract, structural params, assets); `docs/adding-a-module.md` gains "Wrapping a Vital module" (a spec file + `builtin.cpp` line; hidden controls; overrides).
- [ ] **Step 4: Run everything** (`npm run engine:test`, `npm test`, `npm run lint:fix`, `npm run typecheck`), commit `feat(engine): catalog JSON, golden synth render, module docs`.

---

## Self-review against the amendment

| Requirement | Task |
|---|---|
| Module-level adapter: prepare (create, configure, init, plug, switches), process (bind, triggers, pitch→MIDI, knobs, run, outputs) | 2 |
| Descriptors generated from `vital::Parameters` (min/max/default/units/enum); hidden controls; modulatable via destinations | 2, 6 |
| Modulation = `(effective − knob)` into Vital destinations; knob via `Value::set` on the audio thread only | 2 |
| Triggers: rising → `kVoiceOn`, falling → `kVoiceOff`, per lane, with sample offset | 2 |
| Structural params (LFO shape, wavetable choice) rebuild the instance; assets through banks | 1, 3, 5, 7 |
| Voice mask to modules (`kActiveVoices`) | 1, 3 |
| 14 Vital-backed modules: osc.wavetable, filter.multi, env.dahdsr, mod.lfo, mod.random, sampler.player, 8 fx | 2–7 |
| Own modules: phase.clock, math.scaleOffset, mix.mixer, amp.vca, note.toCv | 4, 8 |
| `.vitaltable` JSON loading + builtin tables | 3 |
| `--catalog` + shared zod schema + golden synth render | 9 |
| `[rt]` test for every module; trademark rule | 2–8, 9 (grep already in Task 6 of the foundation plan's lint) |

Deferred to later plans: `io.midiIn` (needs libremidi and the MIDI service; lands with phase 4 protocol/services), `display.scope`/`display.meter` (telemetry slots, phase 5), oversampling wrappers, per-voice buffers (polyphony), zero-copy output binding.

Known risks recorded: Vital's `SynthOscillator` may allocate lazily on its first pitch-bin change (Task 3's RT test warms up first and reports the count); `LfoModule` control-rate switching via `setControlRate(false)` must be verified against the vendored header; `EnvelopeModule::init()` does not call `SynthModule::init()`, so the adapter must not depend on `initialized()`.

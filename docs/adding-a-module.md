# Adding a module

1. Create `engine/src/modules/<Name>.cpp`: static C-layout port/param arrays, a class deriving `VoicedModule<State>` with all
   mutable state in `State`, and `const ModuleDescriptor k<Name>` in namespace `pg::modules`.
2. Add `&modules::k<Name>` to the list in `engine/src/modules/builtin.cpp` (plus an `extern` line).
3. `npm run engine:test`. Add a null test (silence in → silence out) and, for oscillators, a spectral test.
4. No TypeScript changes: the catalog is generated from the descriptor.

Signals are `Sample` (poly_float) frames: write the same value to all lanes for mono, use `lanes::left()/right()` masks for stereo.

## Template

```cpp
#include "core/Module.hpp"
namespace pg::modules {
namespace {
const PortDesc kIn[]  = {{"in", "In", PortKind::Continuous, 1, SignalRole::Any, ""}};
const PortDesc kOut[] = {{"out", "Out", PortKind::Continuous, 1, SignalRole::Any, ""}};
const ParamDesc kParams[] = {{"amount", "Amount", 0.f, 1.f, 0.5f, ParamUnit::None, ParamCurve::Linear, kParamModulatable, nullptr, 0, "slider", nullptr, ""}};
struct State { Sample z = Sample(0.f); };
class Example final : public VoicedModule<State> {
  void process(ProcessContext& c) override {
    State& s = st(c);
    const Sample* in = c.in(0).readOr();
    Sample* out = c.out(0).data; const ParamView amt = c.param(0);
    for (uint32_t i = 0; i < c.numFrames; ++i) { s.z += amt.at(i) * (in[i] - s.z); out[i] = s.z; }
  }
};
}  // namespace
extern const ModuleDescriptor kExample{kModuleAbiVersion, "fx.example", "Example", "fx", "One-pole smoother.",
  kIn, countOf(kIn), kOut, countOf(kOut), kParams, countOf(kParams), 0, 0, [] () -> Module* { return new Example(); }};
}  // namespace pg::modules
```

Rules: no statics for state, no allocation in `process`, params are numeric only, `numFrames` can be 1 (feedback clusters).
Unconnected continuous inputs are empty `SignalView`s; read through `readOr()`.

## Wrapping a vendored module

A module built on the vendored DSP (`engine/vendor/vital`) has no class of its own. It is one `ModuleSpec` value in a
single `.cpp` under `engine/src/modules/vital`, handed to `buildDescriptor`, plus one line in `builtin.cpp`. There is
still no TypeScript change: the descriptor — ranges, units, enum labels and all — is generated from the vendored
parameter table at registry time, and `--catalog` publishes it.

```cpp
const ModuleDescriptor& myModule() {
  static const ModuleDescriptor& desc = [] () -> const ModuleDescriptor& {
    vendor::ModuleSpec spec;
    spec.id = "cat.thing";  spec.name = "Thing";  spec.category = "cat";  spec.doc = "...";
    spec.prefix = "thing_1";                                  // control names are prefix + "_" + suffix
    spec.create = [](vendor::ModuleContext&) { return vendor::makeModule<vital::ThingModule>("thing_1"); };
    spec.inputs  = {{"in", "In", vital::ThingModule::kAudio, vendor::BindKind::Audio, SignalRole::Audio, "..."}};
    spec.outputs = {{"out", "Out", vital::ThingModule::kOut, SignalRole::Audio, "..."}};
    spec.hidden  = {"on"};
    return vendor::buildDescriptor(spec);
  }();
  return desc;
}
```

Checklist, every item of which has already been a bug:

- **`makeModule<T>`, never `new T`.** It wraps the type so the vendored router actually runs its *sorted* order; a
  bare `new` makes a module that plugs a processor before creating its controls read them a block late, and read
  zero on the first block. See docs/engine.md.
- **`prefix` even when the vendored module hard-codes its names.** The sample player calls its controls `sample_*`
  rather than taking a prefix argument, but `prefix = "sample"` is still what turns them into `level` and `loop`
  instead of `sample_level` and `sample_loop`.
- **Check each exposed output against the vendored `process()`.** Some fill a full-size Output but only ever write
  `buffer[0]`; those need `OutputMap::firstFrameOnly`. `Output::isControlRate()` does not catch them.
- **Check every `kIndexed` control's name table length against its own range.** When the names depend on a second
  control the table is shorter, and generating labels reads off its end; set `ControlOverride::suppressLabels` and
  document the control as a plain integer.
- **`hidden` only matches controls the module actually creates**, and it is load-bearing: an exposed control the
  module needs held at a non-default value (`sample_on`) gets the descriptor default written back over it every
  block. Check `getControls()` after `init()`, not the parameter table.
- **`kMaxPortsPerModule` is 32**, counted as declared inputs + *all* params (`osc.wavetable` is at 31).
- **Test with a settled source, not an impulse in block 0**: every effect ramps its wet/dry mix, and the filters
  their coefficients, up from zero across the first block they see.
- **Give it an `[rt]` test that first asserts the graph is producing output**, so it cannot pass by measuring silence.

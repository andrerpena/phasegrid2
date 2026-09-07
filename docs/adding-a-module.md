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
Vital-backed modules are added through the adapter described in the `vital-modules` plan, not this template.

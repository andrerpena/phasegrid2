#include "core/Module.hpp"

namespace pg::modules {
namespace {

const PortDesc kIn[] = {
  {"in", "In", PortKind::Continuous, 1, SignalRole::Any, "Signal to scale and shift"},
};
const PortDesc kOut[] = {
  {"out", "Out", PortKind::Continuous, 1, SignalRole::Any, "in * Scale + Offset"},
};
const ParamDesc kParams[] = {
  {"scale", "Scale", -4.f, 4.f, 1.f, ParamUnit::Ratio, ParamCurve::Linear, kParamPrimary | kParamModulatable, nullptr, 0,
   "slider", nullptr, "What the input is multiplied by. Negative values invert it"},
  {"offset", "Offset", -1.f, 1.f, 0.f, ParamUnit::None, ParamCurve::Linear, kParamPrimary | kParamModulatable, nullptr, 0,
   "slider", nullptr, "Added after the scale"},
};

class ScaleOffset final : public VoicedModule<int> {
  void process(ProcessContext& c) override {
    const Sample* in = c.in(0).readOr();
    Sample* out = c.out(0).data;
    const ParamView scale = c.param(0), offset = c.param(1);
    for (uint32_t i = 0; i < c.numFrames; ++i) out[i] = in[i] * scale.at(i) + offset.at(i);
  }
};

}  // namespace

// Explicit `extern` (see AudioOut.cpp): a namespace-scope `const` is internal linkage by default.
extern const ModuleDescriptor kScaleOffset{kModuleAbiVersion, "math.scaleOffset", "Scale / Offset", "Math",
  "Affine map of one signal: out = in * Scale + Offset, lane by lane. The usual way to turn a unipolar "
  "envelope or LFO into the bipolar range a pitch or pan input wants, and back.",
  kIn, countOf(kIn), kOut, countOf(kOut), kParams, countOf(kParams), 0, 0,
  [] () -> Module* { return new ScaleOffset(); }, nullptr, 0};

}  // namespace pg::modules

#include "core/Module.hpp"

namespace pg::modules {
namespace {

constexpr uint32_t kChannels = 4;

const PortDesc kIn[] = {
  {"in1", "In 1", PortKind::Continuous, 1, SignalRole::Audio, "Channel 1"},
  {"in2", "In 2", PortKind::Continuous, 1, SignalRole::Audio, "Channel 2"},
  {"in3", "In 3", PortKind::Continuous, 1, SignalRole::Audio, "Channel 3"},
  {"in4", "In 4", PortKind::Continuous, 1, SignalRole::Audio, "Channel 4"},
};
const PortDesc kOut[] = {
  {"out", "Out", PortKind::Continuous, 1, SignalRole::Audio, "Sum of the four channels after their levels"},
};
const ParamDesc kParams[] = {
  {"level1", "Level 1", 0.f, 2.f, 1.f, ParamUnit::Ratio, ParamCurve::Linear, kParamPrimary | kParamModulatable, nullptr, 0, "slider", nullptr, "Gain of channel 1"},
  {"level2", "Level 2", 0.f, 2.f, 1.f, ParamUnit::Ratio, ParamCurve::Linear, kParamPrimary | kParamModulatable, nullptr, 0, "slider", nullptr, "Gain of channel 2"},
  {"level3", "Level 3", 0.f, 2.f, 1.f, ParamUnit::Ratio, ParamCurve::Linear, kParamPrimary | kParamModulatable, nullptr, 0, "slider", nullptr, "Gain of channel 3"},
  {"level4", "Level 4", 0.f, 2.f, 1.f, ParamUnit::Ratio, ParamCurve::Linear, kParamPrimary | kParamModulatable, nullptr, 0, "slider", nullptr, "Gain of channel 4"},
};

class Mixer final : public VoicedModule<int> {
  void process(ProcessContext& c) override {
    Sample* out = c.out(0).data;
    for (uint32_t i = 0; i < c.numFrames; ++i) out[i] = Sample(0.f);
    for (uint32_t ch = 0; ch < kChannels; ++ch) {
      // An unconnected channel contributes nothing, whatever its level says. Skipping it outright rather
      // than adding silence keeps a four-way mixer with one cable from doing four times the work.
      const SignalView& in = c.in(ch);
      if (in.empty()) continue;
      const ParamView level = c.param(ch);
      for (uint32_t i = 0; i < c.numFrames; ++i) out[i] += in.data[i] * level.at(i);
    }
  }
};

}  // namespace

// Explicit `extern` (see AudioOut.cpp): a namespace-scope `const` is internal linkage by default.
extern const ModuleDescriptor kMixer{kModuleAbiVersion, "mix.mixer", "Mixer", "Mixing",
  "Adds four signals, each through its own level. Unconnected channels are silent.",
  kIn, countOf(kIn), kOut, countOf(kOut), kParams, countOf(kParams), 0, 0,
  [] () -> Module* { return new Mixer(); }, nullptr, 0};

}  // namespace pg::modules

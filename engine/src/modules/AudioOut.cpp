#include "core/Module.hpp"
#include "poly_utils.h"

namespace pg::modules {
namespace {
const PortDesc kIn[] = {
  {"inL", "In L", PortKind::Continuous, 1, SignalRole::Audio, "Left channel (L lanes). If inR is unconnected, also used for R."},
  {"inR", "In R", PortKind::Continuous, 1, SignalRole::Audio, "Right channel (R lanes)"},
};
const ParamDesc kParams[] = {
  {"gain", "Gain", 0.f, 2.f, 1.f, ParamUnit::Ratio, ParamCurve::Linear, kParamPrimary | kParamModulatable, nullptr, 0, "slider", nullptr, "Output gain"},
};

class AudioOut final : public VoicedModule<int> {
  void process(ProcessContext& c) override {
    if (!c.outputBus) return;
    const SignalView& l = c.in(0);
    const SignalView& r = c.in(1);
    const ParamView g = c.param(0);
    const Mask leftMask = lanes::left(), rightMask = lanes::right();
    for (uint32_t i = 0; i < c.numFrames; ++i) {
      const Sample left = l.readOr()[i] & leftMask;                               // v0.L, v1.L
      Sample right;
      if (r.empty()) right = vital::utils::swapStereo(left);                      // mirror L into R lanes
      else right = r.data[i] & rightMask;
      // Mask HERE, not at the fold: the bus has every voice pair's contribution in it by the time
      // Engine::renderBlock folds it, and no single mask describes that sum. This is the one place
      // the pair whose lanes these are is still known.
      c.outputBus->data[i] += ((left + right) * g.at(i)) & c.voiceMask;
    }
  }
};
}  // namespace

// Explicit `extern` here (not just in builtin.cpp) is required: a namespace-scope `const`
// defaults to internal linkage in C++, and with no use inside this TU the optimizer would
// otherwise discard it, leaving builtin.cpp's reference undefined at link time.
extern const ModuleDescriptor kAudioOut{kModuleAbiVersion, "io.audioOut", "Audio Out", "io",
  "Sends stereo audio to the engine output. Voices are summed.",
  kIn, countOf(kIn), nullptr, 0, kParams, countOf(kParams), kModuleTerminal, 0, [] () -> Module* { return new AudioOut(); }};
}  // namespace pg::modules

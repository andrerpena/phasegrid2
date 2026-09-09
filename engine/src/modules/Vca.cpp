#include "core/Module.hpp"
#include "poly_utils.h"

namespace pg::modules {
namespace {

const PortDesc kIn[] = {
  {"in", "In", PortKind::Continuous, 1, SignalRole::Audio, "Signal to amplify"},
  {"gain", "Gain", PortKind::Continuous, 1, SignalRole::Cv, "Control signal, added to the Gain knob before the curve"},
};
const PortDesc kOut[] = {
  {"out", "Out", PortKind::Continuous, 1, SignalRole::Audio, "in * curve(Gain knob + gain input)"},
};
const char* const kCurveLabels[] = {"Linear", "Exponential"};
const ParamDesc kParams[] = {
  {"gain", "Gain", 0.f, 2.f, 1.f, ParamUnit::Ratio, ParamCurve::Linear, kParamPrimary | kParamModulatable, nullptr, 0,
   "slider", nullptr, "Gain with nothing plugged into the gain input; the input adds to it"},
  {"curve", "Curve", 0.f, 1.f, 0.f, ParamUnit::None, ParamCurve::Linear,
   kParamEnum | kParamInteger | kParamNoSmooth, kCurveLabels, countOf(kCurveLabels), "select", nullptr,
   "Linear multiplies by the sum; Exponential squares it first, which tracks how loudness is heard"},
};

class Vca final : public VoicedModule<int> {
  void process(ProcessContext& c) override {
    const Sample* in = c.in(0).readOr();
    const Sample* gainIn = c.in(1).readOr();
    Sample* out = c.out(0).data;
    const ParamView gain = c.param(0);
    // Stepped param, so it is constant for the block: branch once here rather than per sample.
    const bool exponential = lanes::lane(c.param(1).at(0), 0) >= 0.5f;
    const Sample zero(0.f);
    for (uint32_t i = 0; i < c.numFrames; ++i) {
      // Clamped at zero: a control signal that swings negative closes the VCA rather than inverting the
      // signal, which is what an amplifier does and what keeps `Exponential` from folding back up.
      const Sample sum = vital::utils::max(gain.at(i) + gainIn[i], zero);
      out[i] = in[i] * (exponential ? sum * sum : sum);
    }
  }
};

}  // namespace

// Explicit `extern` (see AudioOut.cpp): a namespace-scope `const` is internal linkage by default.
extern const ModuleDescriptor kVca{kModuleAbiVersion, "amp.vca", "VCA", "amp",
  "Voltage-controlled amplifier: multiplies its input by the Gain knob plus the gain input, clamped at "
  "zero. Plug an envelope into gain and turn the knob down to shape a note.",
  kIn, countOf(kIn), kOut, countOf(kOut), kParams, countOf(kParams), 0, 0,
  [] () -> Module* { return new Vca(); }, nullptr, 0};

}  // namespace pg::modules

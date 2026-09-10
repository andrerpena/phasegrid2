#include <algorithm>
#include <cmath>
#include "core/Module.hpp"
#include "core/Voices.hpp"
#include "poly_utils.h"

namespace pg::modules {
namespace {
const PortDesc kIn[] = {
  {"inL", "In L", PortKind::Continuous, 1, SignalRole::Audio, "Left channel (L lanes). If inR is unconnected, also used for R."},
  {"inR", "In R", PortKind::Continuous, 1, SignalRole::Audio, "Right channel (R lanes)"},
};
const ParamDesc kParams[] = {
  {"gain", "Gain", 0.f, 2.f, 1.f, ParamUnit::Ratio, ParamCurve::Linear, kParamPrimary | kParamModulatable, nullptr, 0, "slider", nullptr, "Output gain"},
  {"lifetime", "Affect voice lifetime", 0.f, 1.f, 0.f, ParamUnit::None, ParamCurve::Linear, kParamInteger | kParamNoSmooth, nullptr, 0,
   "toggle", nullptr,
   "Keep a released voice alive until what arrives here from it has fallen silent. Off, a voice ends with its "
   "envelopes, or with its note when it has none"},
};

/// The face: the two inputs down the left and the gain knob beside them.
const char* const kFace[] = {
  "inL gain gain",
  "inR gain gain",
};

/// The output, and an exit of whatever instrument reaches it: the pair's lanes are summed into the
/// bus here, masked to the voices that exist. Asked to (`lifetime`), it also holds a released voice
/// for as long as it still hears it, the way an envelope holds one until its release is over; by
/// default it does not, and a voice with nothing to hold it ends with its note.
class AudioOut final : public VoicedModule<int> {
  void process(ProcessContext& c) override {
    if (!c.outputBus) return;
    const SignalView& l = c.in(0);
    const SignalView& r = c.in(1);
    const ParamView g = c.param(0);
    const bool holds = lanes::lane(c.param(1).at(0), 0) > 0.5f;
    const Mask leftMask = lanes::left(), rightMask = lanes::right();
    float peak[2] = {0.f, 0.f};
    for (uint32_t i = 0; i < c.numFrames; ++i) {
      const Sample left = l.readOr()[i] & leftMask;                               // v0.L, v1.L
      Sample right;
      if (r.empty()) right = vital::utils::swapStereo(left);                      // mirror L into R lanes
      else right = r.data[i] & rightMask;
      // Mask HERE, not at the fold: the bus has every voice pair's contribution in it by the time
      // Engine::renderBlock folds it, and no single mask describes that sum. This is the one place
      // the pair whose lanes these are is still known. A global signal arrives with voice 0's mask,
      // so its mirrored half is dropped and it reaches the output once.
      const Sample masked = ((left + right) * g.at(i)) & c.voiceMask;
      c.outputBus->data[i] += masked;
      peak[0] = std::max(peak[0], std::max(std::fabs(masked[0]), std::fabs(masked[1])));
      peak[1] = std::max(peak[1], std::max(std::fabs(masked[2]), std::fabs(masked[3])));
    }
    if (holds && c.activity != nullptr) {
      if (peak[0] > kVoiceSilence) c.activity->hold(2 * c.voice);
      if (peak[1] > kVoiceSilence) c.activity->hold(2 * c.voice + 1);
    }
  }
};
}  // namespace

// Explicit `extern` here (not just in builtin.cpp) is required: a namespace-scope `const`
// defaults to internal linkage in C++, and with no use inside this TU the optimizer would
// otherwise discard it, leaving builtin.cpp's reference undefined at link time.
extern const ModuleDescriptor kAudioOut{kModuleAbiVersion, "io.audioOut", "Audio Out", "I/O",
  "Sends stereo audio to the engine output. The voices of an instrument are summed here. With Affect voice lifetime on, "
  "a released voice stays alive until it has fallen silent here.",
  kIn, countOf(kIn), nullptr, 0, kParams, countOf(kParams), kModuleTerminal | kModuleVoiceExit, 0, [] () -> Module* { return new AudioOut(); }, kFace, countOf(kFace)};
}  // namespace pg::modules

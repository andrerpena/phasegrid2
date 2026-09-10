#include <algorithm>
#include <cmath>
#include <vector>
#include "core/Module.hpp"
#include "core/Voices.hpp"
#include "poly_utils.h"

namespace pg::modules {
namespace {

const PortDesc kIn[] = {
  {"in", "In", PortKind::Continuous, 1, SignalRole::Audio, "The voices to sum"},
};
const PortDesc kOut[] = {
  {"out", "Out", PortKind::Continuous, 1, SignalRole::Audio, "Every voice added together: one global stereo signal"},
};

const ParamDesc kParams[] = {
  {"lifetime", "Affect voice lifetime", 0.f, 1.f, 0.f, ParamUnit::None, ParamCurve::Linear, kParamInteger | kParamNoSmooth, nullptr, 0,
   "toggle", nullptr,
   "Keep a released voice alive until what arrives here from it has fallen silent. Off, a voice ends with its "
   "envelopes, or with its note when it has none"},
};

const char* const kFace[] = {"in out"};

/// The end of an instrument, short of the output: sums every voice into one stereo signal that the
/// rest of the patch treats as global, so an effect after it runs once rather than once per voice.
///
/// Runs once per live pair, adding that pair's masked lanes into a scratch block, and writes the sum
/// on the last pass with its second half mirroring its first, which is the shape every global signal
/// has. Asked to (`lifetime`), it holds a released voice for as long as it still hears it, the way an
/// envelope holds one until its release is over. Fed a global signal it is a wire.
class VoiceSum final : public Module {
public:
  void prepare(const PrepareInfo& info) override { scratch_.assign(info.maxBlock, Sample(0.f)); }

  void process(ProcessContext& c) override {
    const Sample* in = c.in(0).readOr();
    Sample* out = c.out(0).data;
    if (c.firstPass) std::fill_n(scratch_.data(), c.numFrames, Sample(0.f));
    const bool holds = lanes::lane(c.param(0).at(0), 0) > 0.5f;
    VoiceGain gain(c.activity, c.voice, c.voiceMask, c.numFrames);
    float peak[2] = {0.f, 0.f};
    for (uint32_t i = 0; i < c.numFrames; ++i) {
      const Sample masked = in[i] * gain.next();
      scratch_[i] += masked;
      peak[0] = std::max(peak[0], std::max(std::fabs(masked[0]), std::fabs(masked[1])));
      peak[1] = std::max(peak[1], std::max(std::fabs(masked[2]), std::fabs(masked[3])));
    }
    if (holds && c.activity != nullptr) {
      if (peak[0] > kVoiceSilence) c.activity->hold(2 * c.voice);
      if (peak[1] > kVoiceSilence) c.activity->hold(2 * c.voice + 1);
    }
    if (!c.lastPass) return;
    // v0 + v1 in both halves: the fold and the mirror in one add.
    for (uint32_t i = 0; i < c.numFrames; ++i) out[i] = scratch_[i] + vital::utils::swapVoices(scratch_[i]);
  }

private:
  std::vector<Sample> scratch_;
};

}  // namespace

extern const ModuleDescriptor kVoiceSum{kModuleAbiVersion, "voices.sum", "Voice Sum", "I/O",
  "Adds every voice of an instrument into one signal. Everything after it is global -- an effect here "
  "runs once, not once per voice. With Affect voice lifetime on, a released voice stays alive until it has "
  "fallen silent here.",
  kIn, countOf(kIn), kOut, countOf(kOut), kParams, countOf(kParams), kModuleVoiceExit, 0,
  [] () -> Module* { return new VoiceSum(); }, kFace, countOf(kFace)};

}  // namespace pg::modules

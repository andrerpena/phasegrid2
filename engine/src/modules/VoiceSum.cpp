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
   "Keep a released voice alive while what arrives here from it is above the silence threshold, or was within the "
   "hold time. Off, a voice ends with its envelopes, or with its note when it has none"},
  {"silence", "Silence threshold", -144.f, 0.f, -96.f, ParamUnit::Db, ParamCurve::Linear, kParamNoSmooth, nullptr, 0,
   "slider", nullptr, "Below this a voice heard here counts as silent"},
  {"hold", "Hold time", 0.f, 1.f, 0.05f, ParamUnit::Seconds, ParamCurve::Linear, kParamNoSmooth, nullptr, 0,
   "slider", nullptr, "How long after its last sound above the threshold a voice is still held"},
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
  void prepare(const PrepareInfo& info) override {
    scratch_.assign(info.maxBlock, Sample(0.f));
    holds_.assign((info.voiceCount + 1) / 2, PairHold{});
    sampleRate_ = info.sampleRate;
  }
  void reset(uint32_t voicePair) override {
    if (voicePair < holds_.size()) holds_[voicePair] = PairHold{};
  }

  void process(ProcessContext& c) override {
    const Sample* in = c.in(0).readOr();
    Sample* out = c.out(0).data;
    if (c.firstPass) std::fill_n(scratch_.data(), c.numFrames, Sample(0.f));
    const bool holds = lanes::lane(c.param(0).at(0), 0) > 0.5f;
    const float silence = dbToAmplitude(lanes::lane(c.param(1).at(0), 0));
    const float holdSamples = lanes::lane(c.param(2).at(0), 0) * static_cast<float>(sampleRate_);
    VoiceGain gain(c.activity, c.voice, c.voiceMask, c.numFrames);
    float peak[2] = {0.f, 0.f};
    for (uint32_t i = 0; i < c.numFrames; ++i) {
      const Sample masked = in[i] * gain.next();
      scratch_[i] += masked;
      peak[0] = std::max(peak[0], std::max(std::fabs(masked[0]), std::fabs(masked[1])));
      peak[1] = std::max(peak[1], std::max(std::fabs(masked[2]), std::fabs(masked[3])));
    }
    if (holds && c.activity != nullptr && c.voice < holds_.size()) {
      for (uint32_t v = 0; v < 2; ++v) {
        ExitHold& h = holds_[c.voice].hold[v];
        if (peak[v] > silence) h.sinceLoud = 0.f;
        else h.sinceLoud = std::min(h.sinceLoud + static_cast<float>(c.numFrames), holdSamples + 1.f);
        if (peak[v] > silence || h.sinceLoud < holdSamples) c.activity->hold(2 * c.voice + v);
      }
    }
    if (!c.lastPass) return;
    // v0 + v1 in both halves: the fold and the mirror in one add.
    for (uint32_t i = 0; i < c.numFrames; ++i) out[i] = scratch_[i] + vital::utils::swapVoices(scratch_[i]);
  }

private:
  struct PairHold { ExitHold hold[2]; };
  std::vector<Sample> scratch_;
  std::vector<PairHold> holds_;   // one per pair, sized in prepare
  double sampleRate_ = 48000.0;
};

}  // namespace

extern const ModuleDescriptor kVoiceSum{kModuleAbiVersion, "voices.sum", "Voice Sum", "I/O",
  "Adds every voice of an instrument into one signal. Everything after it is global -- an effect here "
  "runs once, not once per voice. With Affect voice lifetime on, a released voice stays alive while it is heard "
  "here above the silence threshold or within the hold time.",
  kIn, countOf(kIn), kOut, countOf(kOut), kParams, countOf(kParams), kModuleVoiceExit, 0,
  [] () -> Module* { return new VoiceSum(); }, kFace, countOf(kFace)};

}  // namespace pg::modules

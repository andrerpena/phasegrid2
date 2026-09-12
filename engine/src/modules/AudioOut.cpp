#include <algorithm>
#include <cmath>
#include "core/Module.hpp"
#include "core/Voices.hpp"
#include "futils.h"
#include "poly_utils.h"
#include "services/Telemetry.hpp"

namespace pg::modules {
namespace {
const PortDesc kIn[] = {
  {"inL", "In L", PortKind::Continuous, 1, SignalRole::Audio, "Left channel (L lanes). If inR is unconnected, also used for R."},
  {"inR", "In R", PortKind::Continuous, 1, SignalRole::Audio, "Right channel (R lanes)"},
};

/// The reference instrument's Audio Out, parameter for parameter: a clipping mode and the level it
/// engages at, and under Affect Voice Lifetime the silence threshold and hold time that decide when a
/// voice heard here has stopped. Its defaults are its defaults: Hard at +6 dB, −96 dB, 50 ms.
const char* kClipLabels[] = {"Off", "Hard", "Soft"};
const char* kClipLevelLabels[] = {"0 dB", "+6 dB", "+12 dB", "+24 dB"};
constexpr float kClipLevels[] = {1.f, 2.f, 4.f, 16.f};
enum ClipMode : int { kClipOff = 0, kClipHard = 1, kClipSoft = 2 };

const ParamDesc kParams[] = {
  {"gain", "Gain", 0.f, 2.f, 1.f, ParamUnit::Ratio, ParamCurve::Linear, kParamPrimary | kParamModulatable, nullptr, 0, "slider", nullptr, "Output gain"},
  {"clip", "Clipping", 0.f, 2.f, static_cast<float>(kClipHard), ParamUnit::None, ParamCurve::Linear,
   kParamEnum | kParamInteger | kParamNoSmooth, kClipLabels, countOf(kClipLabels), "select", nullptr,
   "What happens to a sum that runs past the clipping level: nothing, a hard edge, or a rounded knee. The device "
   "itself cuts at full scale whatever is chosen here, so Off is a way of hearing that happen"},
  {"clipLevel", "Clipping level", 0.f, 3.f, 1.f, ParamUnit::None, ParamCurve::Linear,
   kParamEnum | kParamInteger | kParamNoSmooth, kClipLevelLabels, countOf(kClipLevelLabels), "select", nullptr,
   "The level clipping engages at, above full scale"},
  {"lifetime", "Affect voice lifetime", 0.f, 1.f, 0.f, ParamUnit::None, ParamCurve::Linear, kParamInteger | kParamNoSmooth, nullptr, 0,
   "toggle", nullptr,
   "Keep a released voice alive while what arrives here from it is above the silence threshold, or was within the "
   "hold time. Off, a voice ends with its envelopes, or with its note when it has none"},
  {"silence", "Silence threshold", -144.f, 0.f, -96.f, ParamUnit::Db, ParamCurve::Linear, kParamNoSmooth, nullptr, 0,
   "slider", nullptr, "Below this a voice heard here counts as silent"},
  {"hold", "Hold time", 0.f, 1.f, 0.05f, ParamUnit::Seconds, ParamCurve::Linear, kParamNoSmooth, nullptr, 0,
   "slider", nullptr, "How long after its last sound above the threshold a voice is still held"},
};

/// The face: the two inputs down the left, the gain knob, and a meter of what actually went out, with
/// its clip light. A clip lasts one sample and is the one thing an output exists to warn about.
const char* const kFace[] = {
  "inL gain gain meter meter",
  "inR gain gain meter meter",
};

/// How fast the held peak falls and how long a clip stays lit: the same ballistics as `display.meter`.
constexpr float kPeakFallDbPerSecond = 20.f;
constexpr float kClipHoldSeconds = 1.5f;
constexpr uint32_t kChannels = 2;

/// Per voice pair: the hold state of its two voices.
struct OutState {
  ExitHold hold[2];
};

/// The output, and an exit of whatever instrument reaches it: the pair's lanes are summed into the
/// bus here, gained, clipped the way the reference instrument clips, and metered. Asked to
/// (`lifetime`), it also holds a released voice while it still hears it above the threshold or within
/// the hold time, the way an envelope holds one until its release is over; by default it does not, and
/// a voice with nothing to hold it ends with its note.
class AudioOut final : public VoicedModule<OutState> {
  void onPrepare(const PrepareInfo& info) override {
    sampleRate_ = info.sampleRate;
    for (Channel& ch : channels_) ch = Channel{};
  }

  void process(ProcessContext& c) override {
    if (!c.outputBus) return;
    const SignalView& l = c.in(0);
    const SignalView& r = c.in(1);
    const ParamView g = c.param(0);
    const int clip = static_cast<int>(lanes::lane(c.param(1).at(0), 0) + 0.5f);
    const float level = kClipLevels[std::clamp(static_cast<int>(lanes::lane(c.param(2).at(0), 0) + 0.5f), 0, 3)];
    const bool holds = lanes::lane(c.param(3).at(0), 0) > 0.5f;
    const float silence = dbToAmplitude(lanes::lane(c.param(4).at(0), 0));
    const float holdSamples = lanes::lane(c.param(5).at(0), 0) * static_cast<float>(sampleRate_);
    const Mask leftMask = lanes::left(), rightMask = lanes::right();
    VoiceGain gain(c.activity, c.voice, c.voiceMask, c.numFrames);
    const Sample levelS(level);
    const Sample invLevel(1.f / level);

    float peak[2] = {0.f, 0.f};
    if (c.firstPass) for (Channel& ch : channels_) { ch.blockPeak = 0.f; ch.blockSum = 0.f; ch.blockClipped = false; }
    for (uint32_t i = 0; i < c.numFrames; ++i) {
      const Sample left = l.readOr()[i] & leftMask;                               // v0.L, v1.L
      Sample right;
      if (r.empty()) right = vital::utils::swapStereo(left);                      // mirror L into R lanes
      else right = r.data[i] & rightMask;
      // The voice gain goes on HERE, not at the fold: the bus has every voice pair's contribution in
      // it by the time Engine::renderBlock folds it, and no single mask describes that sum. This is the
      // one place the pair whose lanes these are is still known. It carries the lane mask -- a global
      // signal arrives with voice 0's, so its mirrored half is dropped and it reaches the output once --
      // and the ramp of a voice on its way out, so a note ends without a step.
      Sample masked = (left + right) * g.at(i) * gain.next();
      // The clipping stage, per voice pair, before the pairs are summed into the bus. Hard is the
      // reference instrument's default; Soft is a tanh knee that reaches the level asymptotically.
      if (clip == kClipHard) masked = vital::utils::clamp(masked, -level, level);
      else if (clip == kClipSoft) masked = vital::futils::tanh(masked * invLevel) * levelS;
      c.outputBus->data[i] += masked;
      peak[0] = std::max(peak[0], std::max(std::fabs(masked[0]), std::fabs(masked[1])));
      peak[1] = std::max(peak[1], std::max(std::fabs(masked[2]), std::fabs(masked[3])));
    }

    // Voice lifetime: above the threshold now, or within the hold time of having been.
    if (holds && c.activity != nullptr) {
      OutState& st = this->st(c);
      for (uint32_t v = 0; v < 2; ++v) {
        ExitHold& h = st.hold[v];
        if (peak[v] > silence) h.sinceLoud = 0.f;
        else h.sinceLoud = std::min(h.sinceLoud + static_cast<float>(c.numFrames), holdSamples + 1.f);
        if (peak[v] > silence || h.sinceLoud < holdSamples) c.activity->hold(2 * c.voice + v);
      }
    }

    // The meter reads what this module actually sent: the bus's contents once every pair has added
    // in, folded to stereo the way the engine folds them. Accumulated per pass, published on the last.
    if (c.telemetry != nullptr && c.displaySlot != kNoTelemetrySlotCtx) {
      for (uint32_t i = 0; i < c.numFrames; ++i) {
        const Sample s = c.outputBus->data[i];
        const float lr[2] = {s[0] + s[2], s[1] + s[3]};
        for (uint32_t k = 0; k < kChannels; ++k) {
          Channel& ch = channels_[k];
          const float a = std::fabs(lr[k]);
          ch.blockPeak = std::max(ch.blockPeak, a);
          ch.blockSum += lr[k] * lr[k];
          if (a > 1.f) ch.blockClipped = true;
        }
      }
      if (c.lastPass) {
        const float seconds = static_cast<float>(c.numFrames) / static_cast<float>(sampleRate_);
        const float fall = std::pow(10.f, -(kPeakFallDbPerSecond * seconds) / 20.f);
        for (uint32_t k = 0; k < kChannels; ++k) {
          Channel& ch = channels_[k];
          ch.peak = std::max(ch.blockPeak, ch.peak * fall);
          if (ch.blockClipped) ch.clipHold = kClipHoldSeconds * static_cast<float>(sampleRate_);
          else ch.clipHold = std::max(0.f, ch.clipHold - static_cast<float>(c.numFrames));
          float* out = values_ + k * kMeterFloatsPerChannel;
          out[0] = ch.peak;
          out[1] = c.numFrames > 0 ? std::sqrt(ch.blockSum / static_cast<float>(c.numFrames)) : 0.f;
          out[2] = ch.clipHold > 0.f ? 1.f : 0.f;
        }
        c.telemetry->writeMeter(c.displaySlot, values_, kChannels, block_++);
      }
    }
  }

  struct Channel {
    float peak = 0.f;
    float clipHold = 0.f;
    float blockPeak = 0.f, blockSum = 0.f;
    bool blockClipped = false;
  };
  Channel channels_[kChannels];
  float values_[kChannels * kMeterFloatsPerChannel] = {};
  double sampleRate_ = 48000.0;
  uint64_t block_ = 0;
};
}  // namespace

// Explicit `extern` here (not just in builtin.cpp) is required: a namespace-scope `const`
// defaults to internal linkage in C++, and with no use inside this TU the optimizer would
// otherwise discard it, leaving builtin.cpp's reference undefined at link time.
extern const ModuleDescriptor kAudioOut{kModuleAbiVersion, "io.audioOut", "Audio Out", "I/O",
  "Sends stereo audio to the engine output. The voices of an instrument are summed here, clipped at the clipping "
  "level in the chosen way, and metered with a clip light. With Affect voice lifetime on, a released voice stays "
  "alive while it is heard here above the silence threshold or within the hold time.",
  kIn, countOf(kIn), nullptr, 0, kParams, countOf(kParams),
  kModuleTerminal | kModuleVoiceExit | kModuleWritesTelemetry | kModulePublishesMeter, 1,
  [] () -> Module* { return new AudioOut(); }, kFace, countOf(kFace)};
}  // namespace pg::modules

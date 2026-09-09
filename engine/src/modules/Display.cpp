#include <algorithm>
#include <cmath>
#include <vector>

#include "core/Module.hpp"
#include "poly_utils.h"
#include "services/Telemetry.hpp"

namespace pg::modules {
namespace {

/**
 * The display modules: `display.meter`, `display.scope` and `display.value`.
 *
 * Both take a signal and publish it into the shared-memory segment for the interface to draw. They
 * produce no audio and have no outputs, so a patch can tap any wire without changing what it sounds
 * like. Nobody watching means no slot, and then `process` does nothing at all.
 *
 * Voices are folded to stereo the way `io.audioOut` folds them, so a meter reads what the output reads
 * rather than one voice of it. Because the scheduler runs the whole graph once per voice pair over
 * shared buffers, the fold accumulates across pairs into per-instance scratch and publishes on the last
 * one; publishing every pair would let a reader catch a partial sum and show a meter that dips.
 */

/// One pair's contribution, folded to left and right and masked to the voices that exist.
void accumulate(const Sample* in, uint32_t frames, Mask voiceMask, float* interleaved) {
  for (uint32_t i = 0; i < frames; ++i) {
    const Sample masked = in[i] & voiceMask;
    const Sample folded = masked + vital::utils::swapVoices(masked);
    interleaved[i * 2 + 0] += folded[0];
    interleaved[i * 2 + 1] += folded[1];
  }
}

/**
 * The fold, shared by both. Not a `VoicedModule`: its state is per instance rather than per voice
 * pair, because the whole point is to sum every pair into one stereo picture; a per-pair state would
 * give one meter per pair and no way to combine them.
 *
 * `process` folds this pair into scratch and, on the last pair, hands the block to `publish`.
 */
class Display : public Module {
public:
  void prepare(const PrepareInfo& info) override {
    // The only place allocation is allowed. Sized for the largest block the engine will ever hand us.
    scratch_.assign(static_cast<size_t>(info.maxBlock) * 2, 0.f);
    block_ = 0;
    prepared(info);
  }

  void process(ProcessContext& c) override {
    // No segment, or nobody subscribed. This is a fast path rather than a correctness guard: the writer
    // also rejects an out-of-range slot, so removing this check changes nothing observable except that
    // an unwatched meter would do the fold work every block for nobody.
    if (c.telemetry == nullptr || c.telemetrySlot == kNoTelemetrySlot) return;

    float* out = scratch_.data();
    if (c.voice == 0) std::fill_n(out, static_cast<size_t>(c.numFrames) * 2, 0.f);
    accumulate(c.in(0).readOr(), c.numFrames, c.voiceMask, out);

    if (c.voice + 1 < c.voicePairs) return;   // more pairs still to add
    ++block_;
    publish(c, out);
  }

protected:
  virtual void prepared(const PrepareInfo&) {}
  /// The folded stereo block, interleaved, `c.numFrames` long. Audio thread.
  virtual void publish(ProcessContext& c, const float* interleaved) = 0;
  uint64_t block_ = 0;

private:
  /// Interleaved stereo, accumulated across voice pairs. Sized at prepare, never on the audio thread.
  std::vector<float> scratch_;
};

/// How fast a held peak falls once the signal has, in decibels per second. Slow enough to read a
/// transient, fast enough that the meter follows a fade.
inline constexpr float kPeakFallDbPerSecond = 20.f;
/// How long a clip stays lit, in seconds. A clip lasts one sample and a reader looks sixty times a
/// second; without a hold the one thing a meter exists to tell you is the thing it would miss.
inline constexpr float kClipHoldSeconds = 1.5f;

/**
 * Level: the held peak, the RMS and whether it has clipped, per channel.
 *
 * The ballistics live here rather than in the reader or the writer. A block is a few milliseconds and
 * an interface reads one block in six, so a peak worked out per block and thrown away is a peak that
 * is usually missed; holding it here means every reading a reader takes is the true maximum since it
 * last looked, however often that is. The same argument, more sharply, for the clip flag: clipping is
 * the one thing a meter exists to report, and it can last a single sample.
 */
class Meter final : public Display {
  void prepared(const PrepareInfo& info) override {
    sampleRate_ = info.sampleRate;
    for (Channel& ch : channels_) ch = Channel{};
  }

  void publish(ProcessContext& c, const float* interleaved) override {
    const float seconds = static_cast<float>(c.numFrames) / static_cast<float>(sampleRate_);
    // Decibels per second is what a meter's fall is specified in, so the multiplier is exponential in
    // amplitude. One `pow` per block: a call, not an allocation, a lock or a syscall.
    const float fall = std::pow(10.f, -(kPeakFallDbPerSecond * seconds) / 20.f);

    for (uint32_t k = 0; k < kChannels; ++k) {
      Channel& ch = channels_[k];
      float peak = 0.f, sum = 0.f;
      bool clipped = false;
      for (uint32_t i = 0; i < c.numFrames; ++i) {
        const float v = interleaved[i * kChannels + k];
        const float a = std::fabs(v);
        if (a > peak) peak = a;
        sum += v * v;
        if (a > 1.f) clipped = true;
      }
      ch.peak = std::max(peak, ch.peak * fall);
      if (clipped) ch.clipHold = kClipHoldSeconds * static_cast<float>(sampleRate_);
      else ch.clipHold = std::max(0.f, ch.clipHold - static_cast<float>(c.numFrames));

      float* out = values_ + k * kMeterFloatsPerChannel;
      out[0] = ch.peak;
      out[1] = c.numFrames > 0 ? std::sqrt(sum / static_cast<float>(c.numFrames)) : 0.f;
      out[2] = ch.clipHold > 0.f ? 1.f : 0.f;
    }
    c.telemetry->writeMeter(c.telemetrySlot, values_, kChannels, block_);
  }

  static constexpr uint32_t kChannels = 2;
  struct Channel {
    /// The peak being held, falling towards the signal between transients.
    float peak = 0.f;
    /// Samples of clip indication still owed. Counted down rather than timed: the audio thread has no clock.
    float clipHold = 0.f;
  };
  Channel channels_[kChannels];
  float values_[kChannels * kMeterFloatsPerChannel] = {};
  double sampleRate_ = 48000.0;
};

/**
 * A rolling window of the signal, `kTelemetryScopeFrames` long, published whole every block.
 *
 * A block is a few milliseconds, which is a fraction of one cycle of anything you would want to look
 * at, so the window has to be longer than a block and someone has to keep it. That someone is this
 * module rather than the reader: the reader runs at frame rate and would see one block in six. The
 * `time` knob says how long the window is, and the module decimates to fit -- one sample kept in every
 * `stride`, where `stride` is whatever makes `time` fill the window. A sample rather than a peak,
 * because a scope shows the signal; the drawing decides how to fit it to the pixels it has.
 */
class Scope final : public Display {
  void prepared(const PrepareInfo& info) override {
    ring_.assign(static_cast<size_t>(kTelemetryScopeFrames) * 2, 0.f);
    sampleRate_ = info.sampleRate;
    restart(0);
  }

  void publish(ProcessContext& c, const float* interleaved) override {
    // `time` is a display setting, not modulatable, so the block's knob value is the whole story.
    const double seconds = static_cast<double>(c.param(0).knob) / 1000.0;
    const uint32_t stride = static_cast<uint32_t>(
        std::max(1.0, std::round(seconds * sampleRate_ / static_cast<double>(kTelemetryScopeFrames))));
    // A window that is half one timescale and half another reads as a signal that changed; start over.
    if (stride != stride_) restart(stride);

    for (uint32_t i = 0; i < c.numFrames; ++i) {
      if (phase_ == 0) {
        ring_[head_ * 2 + 0] = interleaved[i * 2 + 0];
        ring_[head_ * 2 + 1] = interleaved[i * 2 + 1];
        head_ = (head_ + 1) % kTelemetryScopeFrames;
        if (filled_ < kTelemetryScopeFrames) ++filled_;
      }
      if (++phase_ == stride_) phase_ = 0;
    }
    // Until the ring has wrapped its oldest frame is frame 0; after that it is the one the head is
    // about to overwrite.
    const uint32_t first = filled_ < kTelemetryScopeFrames ? 0 : head_;
    c.telemetry->writeScope(c.telemetrySlot, ring_.data(), 2, filled_, block_, first);
  }

  void restart(uint32_t stride) {
    stride_ = stride;
    head_ = 0;
    filled_ = 0;
    phase_ = 0;
  }

  /// Interleaved stereo ring, one window long. Sized at prepare, never on the audio thread.
  std::vector<float> ring_;
  double sampleRate_ = 48000.0;
  uint32_t stride_ = 0;
  uint32_t head_ = 0;
  uint32_t filled_ = 0;
  /// Samples seen since the last one kept; a sample is kept when this is zero.
  uint32_t phase_ = 0;
};

/**
 * The last value on the wire, per channel, published every block.
 *
 * The last frame rather than an average of the block: a readout is for a control voltage, and what a
 * control voltage is right now is the whole question. An audio signal read this way flickers, which is
 * the honest picture of a value that changes every sample.
 */
class Value final : public Display {
  void publish(ProcessContext& c, const float* interleaved) override {
    const uint32_t last = c.numFrames == 0 ? 0 : c.numFrames - 1;
    const float frame[2] = {interleaved[last * 2 + 0], interleaved[last * 2 + 1]};
    c.telemetry->writeValue(c.telemetrySlot, frame, 2, block_);
  }
};

const PortDesc kIn[] = {
  {"in", "In", PortKind::Continuous, 1, SignalRole::Any, "Signal to display; voices are summed as at the output"},
};

const ParamDesc kScopeParams[] = {
  {"time", "Time", 2.f, 500.f, 20.f, ParamUnit::None, ParamCurve::Log, kParamPrimary | kParamNoSmooth, nullptr, 0, "knob", nullptr,
   "How much of the signal the screen shows, in milliseconds"},
};

/// The screen four cells wide, the input at its left, the timebase at its right.
const char* const kScopeFace[] = {
  "in scope scope scope scope time time",
  ".  scope scope scope scope time time",
  ".  scope scope scope scope .    .   ",
};

/// The face: the input at the left, the two bars filling the rest.
const char* const kMeterFace[] = {
  "in meter meter meter",
  ".  meter meter meter",
};

/// The face: the input at the left, the reading filling the rest.
const char* const kValueFace[] = {
  "in value value value",
  ".  value value value",
};

}  // namespace

extern const ModuleDescriptor kMeter{kModuleAbiVersion, "display.meter", "Meter", "display",
  "Shows the level on its face: a bar per channel, the held peak above it, and a clip light. Produces no audio and changes nothing.",
  kIn, countOf(kIn), nullptr, 0, nullptr, 0, kModuleWritesTelemetry | kModulePublishesMeter, 1,
  [] () -> Module* { return new Meter(); }, kMeterFace, countOf(kMeterFace)};

extern const ModuleDescriptor kScope{kModuleAbiVersion, "display.scope", "Scope", "display",
  "Shows the waveform on its face: a rolling window of the signal, as long as Time says. Produces no audio and changes nothing.",
  kIn, countOf(kIn), nullptr, 0, kScopeParams, countOf(kScopeParams), kModuleWritesTelemetry | kModulePublishesScope, 1,
  [] () -> Module* { return new Scope(); }, kScopeFace, countOf(kScopeFace)};

extern const ModuleDescriptor kValue{kModuleAbiVersion, "display.value", "Value", "display",
  "Shows the value on its input as a number, per channel, as it changes. Produces no audio and changes nothing.",
  kIn, countOf(kIn), nullptr, 0, nullptr, 0, kModuleWritesTelemetry | kModulePublishesValue, 1,
  [] () -> Module* { return new Value(); }, kValueFace, countOf(kValueFace)};

}  // namespace pg::modules

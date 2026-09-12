#pragma once
/// The life of an instrument's voices, as the audio thread sees it.
///
/// An instrument is the region of a patch between a note converter (its entry) and the point where
/// its voices are summed (its exits). The converter owns a pool of `voices`; this is the state of that
/// pool: which voices are held, which are still ringing out after their note off, and which are free.
/// The scheduler runs a voice pair only while one of its voices is not free, so a pool of sixteen
/// costs nothing while nothing plays.
///
/// When a released voice ends is the rule the reference instrument uses: a voice lives while its note
/// is held, and after the note off only while some module in the instrument is still holding it. An
/// envelope holds the voice until its release stage is over; an exit can be asked to hold it until
/// what it hears has fallen silent. A voice nobody holds is free at the end of the block its note
/// ended in, so a bare oscillator stops with its note instead of droning on, and a run of notes into
/// it plays one voice rather than filling the pool. Nothing here measures the audio itself: whether
/// a voice is still going is knowledge the modules that make it going have, and the pool only counts
/// their claims. Every claim lasts one block and is made again each block the voice is still going.
///
/// A voice does not stop dead when its last holder lets go. It is ramped to silence over
/// `kVoiceFadeSeconds` first, because a wave cut off mid-cycle is a step to zero and a step is a click:
/// the patch that made this rule audible had no envelope anywhere, so every note ended at full scale.
/// The fade is committed once it starts -- a holder cannot take it back, or an exit that stops hearing a
/// voice *because* it is fading would restart the ramp and click. Only a new note on that voice cancels
/// it. The exits apply it as they fold (`VoiceGain`); the pool only counts the samples.
///
/// Written only on the audio thread -- the entry marks notes on and off in its allocation pass, the
/// holders claim per pass, the scheduler settles the block -- and built on the message thread by the
/// compiler. Owned by `InstanceTable`, keyed by the entry node, so it outlives a recompile the way a
/// feedback state does. Fixed arrays throughout: nothing here allocates.
#include <array>
#include <cmath>
#include <bitset>
#include <cstdint>
#include "core/Conventions.hpp"

namespace pg {

/// An exit that affects voice lifetime decides "still going" the way the reference instrument does: the
/// voice's peak is above a silence threshold, or was within a hold time ago. Both are the exit's own
/// params (`silence`, −96 dB by default; `hold`, 50 ms) and this is the per-voice state behind them,
/// kept by the exit and counted in samples because the audio thread has no clock.
struct ExitHold {
  float sinceLoud = 0.f;   // samples since the voice was last above the threshold; saturates at hold
};
inline float dbToAmplitude(float db) { return std::pow(10.f, db / 20.f); }

/// How long a voice takes to ramp to silence once nothing holds it. Long enough that the cut-off wave
/// does not click, short enough to be inaudible as a release and to have the voice back in the pool
/// before anyone plays another note.
inline constexpr double kVoiceFadeSeconds = 0.003;

enum class VoiceState : uint8_t { Free = 0, Held, Releasing };

class VoiceActivity {
public:
  explicit VoiceActivity(uint32_t voices) : voices_(voices < 1 ? 1 : voices > kMaxVoices ? kMaxVoices : voices) {}

  uint32_t voices() const { return voices_; }
  uint32_t pairs() const { return (voices_ + 1) / 2; }
  /// How many samples the outgoing ramp lasts. Set by the compiler, which knows the sample rate; the
  /// default is `kVoiceFadeSeconds` at 48 kHz so a pool built without one still fades.
  void setFadeSamples(uint32_t samples) { fadeSamples_ = samples < 1 ? 1 : samples; }

  // ---------------------------------------------------------------- the entry, allocation pass
  VoiceState state(uint32_t v) const { return v < voices_ ? state_[v] : VoiceState::Free; }
  uint64_t age(uint32_t v) const { return age_[v]; }
  void noteOn(uint32_t v) {
    if (v >= voices_) return;
    state_[v] = VoiceState::Held;
    age_[v] = nextAge_++;
    fade_[v] = 0;   // a voice taken back mid-fade plays its new note at full level
  }
  /// The note is over. The voice goes on running this block so whatever holds it can say so; it is
  /// free at `settle` if nothing does.
  void noteOff(uint32_t v) {
    if (v >= voices_ || state_[v] != VoiceState::Held) return;
    state_[v] = VoiceState::Releasing;
  }

  // ---------------------------------------------------------------- the holders, every pass
  /// Voice `v` is still going as far as this module is concerned: an envelope that has not finished
  /// its release, an exit that still hears it. Keeps a releasing voice alive through this block.
  void hold(uint32_t v) {
    if (v < voices_) held_.set(v);
  }

  // ---------------------------------------------------------------- the exits, folding
  /// A straight line: the gain voice `v` starts this block at and what to add to it per frame. Flat at
  /// 1 unless the voice is on its way out, and exactly 1 at the first frame of a fade, so the ramp
  /// joins what the last block played without a step of its own.
  struct Ramp {
    float start = 1.f;
    float step = 0.f;
  };
  Ramp fadeRamp(uint32_t v, uint32_t numFrames) const {
    if (v >= voices_ || fade_[v] == 0 || numFrames == 0) return {};
    const float total = static_cast<float>(fadeSamples_);
    const float start = static_cast<float>(fade_[v]) / total;
    const uint32_t left = numFrames >= fade_[v] ? 0 : fade_[v] - numFrames;
    return {start, (static_cast<float>(left) / total - start) / static_cast<float>(numFrames)};
  }

  // ---------------------------------------------------------------- the scheduler
  bool pairLive(uint32_t pair) const {
    const uint32_t v = 2 * pair;
    return state(v) != VoiceState::Free || state(v + 1) != VoiceState::Free;
  }
  /// Lanes of the pair's voices that are not free.
  Mask laneMask(uint32_t pair) const {
    const uint32_t v = 2 * pair;
    const bool a = state(v) != VoiceState::Free, b = state(v + 1) != VoiceState::Free;
    return Mask(a ? -1 : 0, a ? -1 : 0, b ? -1 : 0, b ? -1 : 0);
  }
  /// Whether the pair ran last block: a pair that did not and is live now has been revived, and its
  /// modules are reset before it runs so the new note starts from clean state.
  bool ranLastBlock(uint32_t pair) const { return ran_.test(pair); }
  void markRan(uint32_t pair, bool ran) { ran_.set(pair, ran); }
  /// End of block: a releasing voice nobody held starts its fade, one already fading is that many
  /// samples further through, and one whose fade has run out is free.
  void settle(uint32_t numFrames) {
    for (uint32_t v = 0; v < voices_; ++v) {
      if (state_[v] != VoiceState::Releasing) continue;
      if (fade_[v] != 0) {
        // Committed. `held_` is not consulted: the exits stop hearing a fading voice *because* it is
        // fading, and letting that restart the ramp would put back the click the ramp is here to remove.
        fade_[v] = numFrames >= fade_[v] ? 0 : fade_[v] - numFrames;
        if (fade_[v] == 0) state_[v] = VoiceState::Free;
      } else if (!held_.test(v)) {
        fade_[v] = fadeSamples_;
      }
    }
    held_.reset();
  }
  /// Every voice free, every pair unrun: what a transport panic would want.
  void clear() {
    state_.fill(VoiceState::Free);
    fade_.fill(0);
    held_.reset();
    ran_.reset();
  }

private:
  uint32_t voices_;
  uint32_t fadeSamples_ = static_cast<uint32_t>(kVoiceFadeSeconds * 48000.0);
  std::array<VoiceState, kMaxVoices> state_{};
  std::array<uint64_t, kMaxVoices> age_{};
  std::array<uint32_t, kMaxVoices> fade_{};   // samples of ramp left; 0 is not fading
  std::bitset<kMaxVoices> held_;
  std::bitset<kMaxVoices / 2> ran_;
  uint64_t nextAge_ = 1;
};

/// The gain an exit multiplies a pair's lanes by as it folds them: the lane mask -- a voice that does
/// not exist contributes nothing -- and the ramp of a voice on its way out, in one `Sample`. Built once
/// per block and advanced once per frame, so the fold keeps no branch and no division in its loop.
///
/// Every exit uses this rather than masking, which is what stops the two of them from growing their own
/// ramp code and drifting apart.
class VoiceGain {
public:
  VoiceGain(const VoiceActivity* activity, uint32_t pair, Mask mask, uint32_t numFrames) {
    VoiceActivity::Ramp a, b;
    if (activity != nullptr) {
      a = activity->fadeRamp(2 * pair, numFrames);
      b = activity->fadeRamp(2 * pair + 1, numFrames);
    }
    gain_ = Sample(a.start, a.start, b.start, b.start) & mask;
    step_ = Sample(a.step, a.step, b.step, b.step) & mask;
  }
  /// This frame's gain, then on to the next.
  Sample next() {
    const Sample g = gain_;
    gain_ += step_;
    return g;
  }

private:
  Sample gain_;
  Sample step_;
};

}  // namespace pg

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
/// Written only on the audio thread -- the entry marks notes on and off in its allocation pass, the
/// holders claim per pass, the scheduler settles the block -- and built on the message thread by the
/// compiler. Owned by `InstanceTable`, keyed by the entry node, so it outlives a recompile the way a
/// feedback state does. Fixed arrays throughout: nothing here allocates.
#include <array>
#include <bitset>
#include <cstdint>
#include "core/Conventions.hpp"

namespace pg {

/// Quieter than this, an exit that affects voice lifetime calls a voice silent.
inline constexpr float kVoiceSilence = 1e-4f;

enum class VoiceState : uint8_t { Free = 0, Held, Releasing };

class VoiceActivity {
public:
  explicit VoiceActivity(uint32_t voices) : voices_(voices < 1 ? 1 : voices > kMaxVoices ? kMaxVoices : voices) {}

  uint32_t voices() const { return voices_; }
  uint32_t pairs() const { return (voices_ + 1) / 2; }

  // ---------------------------------------------------------------- the entry, allocation pass
  VoiceState state(uint32_t v) const { return v < voices_ ? state_[v] : VoiceState::Free; }
  uint64_t age(uint32_t v) const { return age_[v]; }
  void noteOn(uint32_t v) {
    if (v >= voices_) return;
    state_[v] = VoiceState::Held;
    age_[v] = nextAge_++;
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
  /// End of block: a releasing voice nobody held this block is free again.
  void settle() {
    for (uint32_t v = 0; v < voices_; ++v)
      if (state_[v] == VoiceState::Releasing && !held_.test(v)) state_[v] = VoiceState::Free;
    held_.reset();
  }
  /// Every voice free, every pair unrun: what a transport panic would want.
  void clear() {
    state_.fill(VoiceState::Free);
    held_.reset();
    ran_.reset();
  }

private:
  uint32_t voices_;
  std::array<VoiceState, kMaxVoices> state_{};
  std::array<uint64_t, kMaxVoices> age_{};
  std::bitset<kMaxVoices> held_;
  std::bitset<kMaxVoices / 2> ran_;
  uint64_t nextAge_ = 1;
};

}  // namespace pg

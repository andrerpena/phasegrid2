#include <algorithm>
#include <vector>

#include "core/Module.hpp"
#include "poly_utils.h"
#include "services/Telemetry.hpp"

namespace pg::modules {
namespace {

/**
 * The two display modules: `display.meter` and `display.scope`.
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
 * Not a `VoicedModule`. Its state is per instance rather than per voice pair, because the whole point is
 * to sum every pair into one stereo picture; a per-pair state would give one meter per pair and no way
 * to combine them.
 */
template <bool kScope>
class Display final : public Module {
public:
  void prepare(const PrepareInfo& info) override {
    // The only place allocation is allowed. Sized for the largest block the engine will ever hand us.
    scratch_.assign(static_cast<size_t>(info.maxBlock) * 2, 0.f);
    block_ = 0;
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
    if constexpr (kScope)
      c.telemetry->writeScope(c.telemetrySlot, out, 2, c.numFrames, block_);
    else
      c.telemetry->writeMeter(c.telemetrySlot, out, 2, c.numFrames, block_);
  }

private:
  /// Interleaved stereo, accumulated across voice pairs. Sized at prepare, never on the audio thread.
  std::vector<float> scratch_;
  uint64_t block_ = 0;
};

const PortDesc kIn[] = {
  {"in", "In", PortKind::Continuous, 1, SignalRole::Any, "Signal to display; voices are summed as at the output"},
};

}  // namespace

extern const ModuleDescriptor kMeter{kModuleAbiVersion, "display.meter", "Meter", "display",
  "Publishes peak, RMS and clip count for the interface to draw. Produces no audio and changes nothing.",
  kIn, countOf(kIn), nullptr, 0, nullptr, 0, kModuleWritesTelemetry, 1,
  [] () -> Module* { return new Display<false>(); }, nullptr, 0};

extern const ModuleDescriptor kScope{kModuleAbiVersion, "display.scope", "Scope", "display",
  "Publishes the waveform for the interface to draw. Produces no audio and changes nothing.",
  kIn, countOf(kIn), nullptr, 0, nullptr, 0, kModuleWritesTelemetry, 1,
  [] () -> Module* { return new Display<true>(); }, nullptr, 0};

}  // namespace pg::modules

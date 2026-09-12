#pragma once
#include <array>
#include <memory>
#include <vector>
#include "core/Module.hpp"
#include "core/Voices.hpp"
#include "sst/Config.hpp"
#include "sst/Descriptors.hpp"

namespace pg::sstfx {

/**
 * The phasegrid `Module` that runs one sst effect.
 *
 * Three jobs, and they are all translation:
 *
 * **Lanes.** Our signal is a `poly_float` of four lanes, `v0.L v0.R v1.L v1.R` -- two VOICES, each in
 * stereo -- and an sst effect takes two plain float arrays, which is one voice. So there is one
 * effect instance per voice, not per pair, and the block is deinterleaved into each and
 * re-interleaved out of it.
 *
 * That is worth stating plainly because the obvious shortcut is wrong. The vendored Vital effects
 * read the pair's FIRST voice and mirror the result onto the second, which is free and correct for a
 * global effect, where only voice 0 carries anything. Inside an instrument it silently drops every
 * odd-numbered voice -- half the notes of a chord vanish -- and it also makes the ring-out rule below
 * impossible to evaluate, because the lane it measures belongs to a different note than the one
 * playing. A reverb patched straight after an oscillator hit both at once and produced no reverb at
 * all (docs/adrs/0010).
 *
 * **Blocks.** An effect processes a fixed `kSstBlock` frames. Our ordinary block is 64, which
 * divides exactly, so the common path runs the effect twice and adds no latency. A module inside a
 * SAMPLE-accurate feedback cluster is run a frame at a time (`Scheduler::runCluster`), which divides
 * nothing, so there is a FIFO for that case; it costs `kSstBlock` samples of latency, and only there.
 *
 * **Units.** The descriptor publishes each control in the unit the effect's own metadata names --
 * seconds, per cent, decibels -- and `Native` turns it back into the number the DSP wants. That
 * conversion is the point of this layer: it is what stops a knob from saying "seconds" while
 * carrying something else.
 */
class WrappedEffect final : public Module {
public:
  static Module* createFromRegistry();   // reads pg::g_creatingDescriptor
  explicit WrappedEffect(const ModuleDescriptor& desc);

  void prepare(const PrepareInfo& info) override;
  void reset(uint32_t voicePair) override;
  void process(ProcessContext& c) override;

private:
  /// The inverse of the display mapping `Descriptors.cpp` publishes: display units back to the
  /// effect's own domain. One per parameter, worked out once in `prepare` from the effect's metadata.
  struct Native {
    enum class Kind : uint8_t { Identity, Linear, Pow2 } kind = Kind::Identity;
    float a = 1.f, b = 0.f, c = 0.f;
    float operator()(float display) const;
  };

  /// Everything one voice's effect needs: the effect, the FIFO for the frame-at-a-time path, and how
  /// long it has been quiet for the ring-out rule.
  struct Voice {
    std::unique_ptr<Instance> fx;
    std::array<float, kSstBlock> inL{}, inR{}, outL{}, outR{};
    uint32_t fill = 0;      ///< frames gathered towards the next block
    uint32_t drained = 0;   ///< frames of `out*` already handed back
    bool primed = false;    ///< false until the first block has been produced
    /// The loudest this voice's input has been lately, decaying slowly. What the ring-out rule
    /// compares against: see the comment on it in the .cpp.
    float loudest = 0.f;
  };

  void runDirect(ProcessContext& c, Voice& v, uint32_t lane, const Sample* in, Sample* out, uint32_t n);
  void runBuffered(ProcessContext& c, Voice& v, uint32_t lane, const Sample* in, Sample* out, uint32_t n);
  void refresh(ProcessContext& c, Instance& fx);

  const ModuleDescriptor& desc_;
  const EffectSpec& spec_;
  std::vector<Voice> voices_;
  std::vector<Native> native_;
  /// Our parameter index to the effect's own: they differ wherever an effect has a hole in its
  /// parameter list that `publishable` skipped.
  std::vector<int> slot_;
  double sampleRate_ = 48000.0;
  /// Below this the effect's output counts as silent and stops claiming its voice.
  static constexpr float kSilence = 1e-5f;   // -100 dB
  /// How far the input has to fall below its recent loudest before it counts as having STOPPED
  /// rather than merely being quiet. -40 dB: past this an envelope is audibly over.
  static constexpr float kStopped = 0.01f;
  /// How fast `Voice::loudest` forgets, per sample. A second or so, so a gap between notes does not
  /// reset it but a patch that genuinely goes quiet for a while does.
  float forget_ = 1.f;
};

}  // namespace pg::sstfx

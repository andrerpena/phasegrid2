#pragma once
#include <array>
#include <memory>
#include <vector>
#include "core/Module.hpp"
#include "sst/Config.hpp"
#include "sst/Descriptors.hpp"

namespace pg::sstfx {

/**
 * The phasegrid `Module` that runs one sst effect.
 *
 * Three jobs, and they are all translation:
 *
 * **Lanes.** Our signal is a `poly_float` of four lanes, `v0.L v0.R v1.L v1.R`; an sst effect takes
 * two plain float arrays. So the block is deinterleaved on the way in and re-interleaved on the way
 * out, reading the pair's FIRST voice and mirroring the result onto the second -- the convention
 * every effect here follows, and why the examples put one after `voices.sum`.
 *
 * **Blocks.** An effect processes a fixed `kSstBlock` frames. Our ordinary block is 64, which
 * divides exactly, so the common path runs the effect twice and adds no latency. A module inside a
 * SAMPLE-accurate feedback cluster is run a frame at a time (`Scheduler::runCluster`), which
 * divides nothing, so there is a FIFO for that case; it costs `kSstBlock` samples of latency, and
 * only there.
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

  void runDirect(ProcessContext& c, Instance& fx, const Sample* in, Sample* out, uint32_t n);
  void runBuffered(ProcessContext& c, Instance& fx, const Sample* in, Sample* out, uint32_t n);
  void refresh(ProcessContext& c, Instance& fx);

  const ModuleDescriptor& desc_;
  const EffectSpec& spec_;
  std::vector<std::unique_ptr<Instance>> pairs_;
  std::vector<Native> native_;
  /// Our parameter index to the effect's own: they differ wherever an effect has a hole in its
  /// parameter list that `publishable` skipped.
  std::vector<int> slot_;
  double sampleRate_ = 48000.0;

  /// The FIFO for the frame-at-a-time case: input waiting to make a full block, and output already
  /// produced and waiting to be handed back. Sized once; `process` never allocates.
  struct Fifo {
    std::array<float, kSstBlock> inL{}, inR{}, outL{}, outR{};
    uint32_t fill = 0;      ///< frames gathered towards the next block
    uint32_t drained = 0;   ///< frames of `out*` already handed back
    bool primed = false;    ///< false until the first block has been produced
  };
  std::vector<Fifo> fifos_;
};

}  // namespace pg::sstfx

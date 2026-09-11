#include "sst/Descriptors.hpp"
#include "sst/effects/Reverb1.h"

namespace pg::modules {

/// `fx.reverb.hall` -- the Surge Synth Team's Reverb 1: an older, plainer plate than `fx.reverb`,
/// with a shape control and a parametric peak in the tail instead of Reverb 2's diffusion network.
const ModuleDescriptor& fxReverbHall() {
  static const ModuleDescriptor& desc = []() -> const ModuleDescriptor& {
    sstfx::EffectSpec spec = sstfx::effectSpec<sst::effects::reverb1::Reverb1<sstfx::Config>>(
      "fx.reverb.hall", "Reverb Hall",
      "A plate reverb. Room Shape and Size choose the space, Decay Time how long it rings, and the "
      "Low Cut, Peak and High Cut shape the tail as it goes.");
    spec.face = {"size", "decay_time", "hf_damping", "mix"};
    return sstfx::buildDescriptor(spec);
  }();
  return desc;
}

}  // namespace pg::modules

#include "sst/Descriptors.hpp"
#include "sst/effects/Flanger.h"

namespace pg::modules {

/// `fx.flanger` -- the Surge Synth Team's flanger: a comb of up to sixteen voices whose spacing and
/// pitch are set rather than swept blindly, so it doubles as a tuned resonator.
const ModuleDescriptor& fxFlanger() {
  static const ModuleDescriptor& desc = []() -> const ModuleDescriptor& {
    sstfx::EffectSpec spec = sstfx::effectSpec<sst::effects::flanger::Flanger<sstfx::Config>>(
      "fx.flanger", "Flanger",
      "A bank of tuned comb filters. Count is how many, Base Pitch where the lowest sits and Spacing "
      "how far apart they are; Rate and Depth move them, and Feedback sharpens each one.");
    spec.face = {"rate", "depth", "feedback", "mix"};
    return sstfx::buildDescriptor(spec);
  }();
  return desc;
}

}  // namespace pg::modules

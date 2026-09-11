#include "sst/Descriptors.hpp"
#include "sst/effects/Delay.h"

namespace pg::modules {

/// `fx.delay` -- the Surge Synth Team's stereo delay: independent left and right times, crossfeed
/// between them, a filtered feedback path and a modulated line.
const ModuleDescriptor& fxDelay() {
  static const ModuleDescriptor& desc = []() -> const ModuleDescriptor& {
    sstfx::EffectSpec spec = sstfx::effectSpec<sst::effects::delay::Delay<sstfx::Config>>(
      "fx.delay", "Delay",
      "A stereo delay. Left and Right set the two times, Feedback how many repeats there are and "
      "Crossfeed how much each side feeds the other; Low Cut and High Cut shape the repeats as they "
      "fade, and Rate and Depth wobble the line.");
    spec.face = {"left", "right", "feedback", "mix"};
    return sstfx::buildDescriptor(spec);
  }();
  return desc;
}

}  // namespace pg::modules

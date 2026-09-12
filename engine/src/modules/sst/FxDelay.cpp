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
    /*
     * Our defaults, not the effect's, and measured (docs/adrs/0010). Shipped, Feedback is 0 and both
     * times are equal: one repeat, in the middle, which is a slapback rather than a delay and shows
     * nothing of what the module does. These give a train of repeats a third of a second apart that
     * walks across the stereo field, which is the thing the module is named after.
     */
    spec.overrides = {
      {.param = "feedback", .hasDefault = true, .def = 40.f},
      {.param = "left", .hasDefault = true, .def = 0.375f},
      {.param = "right", .hasDefault = true, .def = 0.5f},
    };
    spec.face = {"left", "right", "feedback", "mix"};
    return sstfx::buildDescriptor(spec);
  }();
  return desc;
}

}  // namespace pg::modules

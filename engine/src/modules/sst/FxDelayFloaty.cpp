#include "sst/Descriptors.hpp"
#include "sst/effects/FloatyDelay.h"

namespace pg::modules {

/// `fx.delay.floaty` -- a tape-style delay whose repeats can run at a different speed from the
/// signal that made them, so they drift in pitch as they fade.
const ModuleDescriptor& fxDelayFloaty() {
  static const ModuleDescriptor& desc = []() -> const ModuleDescriptor& {
    sstfx::EffectSpec spec = sstfx::effectSpec<sst::effects::floatydelay::FloatyDelay<sstfx::Config>>(
      "fx.delay.floaty", "Floaty Delay",
      "A tape delay that wanders. Playrate runs the repeats faster or slower than what went in, so "
      "they drift in pitch; Pitch Depth and Filter Depth set how far the wander goes.");
    /*
     * Our defaults, not the effect's, and measured (docs/adrs/0010). Shipped, Mix is 30 % and the
     * repeats run through a filter at 1.4 kHz, which on anything but a bright source buries them
     * under the dry signal entirely -- the output measures as a smooth decay with no repeats in it
     * at all. Opening the filter and lifting the mix makes them audible as repeats.
     */
    spec.overrides = {
      {.param = "mix", .hasDefault = true, .def = 50.f},
      {.param = "cutoff", .hasDefault = true, .def = 6000.f},
      {.param = "time", .hasDefault = true, .def = 0.4f},
    };
    spec.face = {"time", "playrate", "feedback", "mix"};
    return sstfx::buildDescriptor(spec);
  }();
  return desc;
}

}  // namespace pg::modules

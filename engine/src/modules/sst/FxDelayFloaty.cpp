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
    spec.face = {"time", "playrate", "feedback", "mix"};
    return sstfx::buildDescriptor(spec);
  }();
  return desc;
}

}  // namespace pg::modules

#include "sst/Descriptors.hpp"
#include "sst/effects/Phaser.h"

namespace pg::modules {

/// `fx.phaser` -- a bank of allpass stages swept together, with the count and their spread exposed.
const ModuleDescriptor& fxPhaser() {
  static const ModuleDescriptor& desc = []() -> const ModuleDescriptor& {
    sstfx::EffectSpec spec = sstfx::effectSpec<sst::effects::phaser::Phaser<sstfx::Config>>(
      "fx.phaser", "Phaser",
      "Allpass stages swept through the signal. Count is how many notches there are, Center and "
      "Spread where they sit, Rate and Depth how they move, and Feedback how deep they cut.");
    spec.face = {"center", "rate", "depth", "mix"};
    return sstfx::buildDescriptor(spec);
  }();
  return desc;
}

}  // namespace pg::modules

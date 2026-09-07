#include "equalizer_module.h"
#include "modules/vital/Effect.hpp"

namespace pg::modules {

/// fx.eq -- the vendored three-band equaliser. Each band switches between a shelf and a cut: low is shelf or
/// high-pass, mid is shelf or notch, high is shelf or low-pass.
const ModuleDescriptor& fxEq() {
  static const ModuleDescriptor& desc = [] () -> const ModuleDescriptor& {
    vendor::ModuleSpec spec = effectSpec(
      "fx.eq", "Equalizer",
      "Three-band equaliser. Each band's Mode picks between a shelf and a cut (low: shelf or high-pass, "
      "band: shelf or notch, high: shelf or low-pass). Cutoffs are MIDI note numbers, gains are decibels.",
      "eq", "Equalised audio");
    spec.create = [](vendor::ModuleContext&) { return vendor::makeModule<vital::EqualizerModule>(); };
    spec.face = {"low_gain", "band_gain", "high_gain", "band_cutoff"};
    return vendor::buildDescriptor(spec);
  }();
  return desc;
}

}  // namespace pg::modules

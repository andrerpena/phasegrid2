#include "sst/Descriptors.hpp"
#include "sst/effects/RotarySpeaker.h"

namespace pg::modules {

/// `fx.rotary` -- a rotating speaker: a horn and a rotor turning at their own rates, with the
/// doppler shift and the tremolo they cause exposed separately.
const ModuleDescriptor& fxRotary() {
  static const ModuleDescriptor& desc = []() -> const ModuleDescriptor& {
    sstfx::EffectSpec spec = sstfx::effectSpec<sst::effects::rotaryspeaker::RotarySpeaker<sstfx::Config>>(
      "fx.rotary", "Rotary Speaker",
      "A speaker on a turntable. The horn and the rotor turn at their own rates; Doppler is the "
      "pitch shift that causes and Tremolo the loudness swing.");
    spec.face = {"horn_rate", "doppler", "tremolo", "mix"};
    return sstfx::buildDescriptor(spec);
  }();
  return desc;
}

}  // namespace pg::modules

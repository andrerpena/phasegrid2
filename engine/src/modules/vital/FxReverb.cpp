#include "modules/vital/Effect.hpp"
#include "reverb_module.h"

namespace pg::modules {

/// fx.reverb -- the vendored reverb: a diffuse network with pre-filtering, low and high shelves and a chorused
/// tail. Cutoffs are MIDI note numbers, decay time is a power of two in seconds.
const ModuleDescriptor& fxReverb() {
  static const ModuleDescriptor& desc = [] () -> const ModuleDescriptor& {
    vendor::ModuleSpec spec = effectSpec(
      "fx.reverb", "Reverb",
      "Reverb with pre-filtering, low/high shelving and a chorused tail. Decay Time is a power of two in "
      "seconds; the cutoffs are MIDI note numbers.",
      "reverb", "Dry/wet reverb output");
    spec.create = [](vendor::ModuleContext&) { return vendor::makeModule<vital::ReverbModule>(); };
    spec.face = {"dry_wet", "decay_time", "size", "delay"};
    return vendor::buildDescriptor(spec);
  }();
  return desc;
}

}  // namespace pg::modules

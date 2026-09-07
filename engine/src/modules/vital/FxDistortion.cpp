#include "distortion_module.h"
#include "modules/vital/Effect.hpp"

namespace pg::modules {

/// fx.distortion -- the vendored waveshaper with an optional filter before or after it.
const ModuleDescriptor& fxDistortion() {
  static const ModuleDescriptor& desc = [] () -> const ModuleDescriptor& {
    vendor::ModuleSpec spec = effectSpec(
      "fx.distortion", "Distortion",
      "Waveshaper -- soft clip, hard clip, folding, bit crush or downsampling -- with a filter that can run "
      "before it, after it, or not at all. Drive is in decibels, Filter Cutoff a MIDI note number.",
      "distortion", "Dry/wet distorted output");
    spec.create = [](vendor::ModuleContext&) { return vendor::makeModule<vital::DistortionModule>(); };
    return vendor::buildDescriptor(spec);
  }();
  return desc;
}

}  // namespace pg::modules

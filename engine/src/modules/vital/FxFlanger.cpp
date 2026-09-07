#include "flanger_module.h"
#include "modules/vital/Effect.hpp"

namespace pg::modules {

/// fx.flanger -- the vendored flanger: one short delay swept by a triangle around Center.
const ModuleDescriptor& fxFlanger() {
  static const ModuleDescriptor& desc = [] () -> const ModuleDescriptor& {
    vendor::ModuleSpec spec = effectSpec(
      "fx.flanger", "Flanger",
      "Flanger: a short feedback delay swept by a triangle around Center. Center is a MIDI note number, "
      "Frequency a power of two in hertz.",
      "flanger", "Dry/wet flanger output");
    spec.create = [](vendor::ModuleContext& ctx) {
      return vendor::makeModule<vital::FlangerModule>(ctx.beatsPerSecond());
    };
    spec.needsBeatsPerSecond = true;
    // The swept delay rate, for driving something else from it. The vendored module works it out once per
    // block and writes it at buffer[0] only, so it has to be broadcast rather than copied.
    spec.outputs.push_back({"frequency", "Frequency", vital::FlangerModule::kFrequencyOutput, SignalRole::Cv,
                            "The delay rate the sweep landed on this block, in hertz", /*firstFrameOnly=*/true});
    spec.face = {"dry_wet", "frequency", "mod_depth", "feedback"};
    return vendor::buildDescriptor(spec);
  }();
  return desc;
}

}  // namespace pg::modules

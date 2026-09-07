#include "chorus_module.h"
#include "modules/vital/Effect.hpp"

namespace pg::modules {

/// fx.chorus -- the vendored chorus: up to four modulated delay pairs around a common rate. Its four delay
/// status readouts (outputs 1..4) are meters for the host's UI, so only the audio output is exposed.
const ModuleDescriptor& fxChorus() {
  static const ModuleDescriptor& desc = [] () -> const ModuleDescriptor& {
    vendor::ModuleSpec spec = effectSpec(
      "fx.chorus", "Chorus",
      "Chorus built from up to four modulated delay pairs sharing one rate. Frequency is a power of two in "
      "hertz; Delay 1 and Delay 2 set the range the pairs are spread across.",
      "chorus", "Dry/wet chorus output");
    spec.create = [](vendor::ModuleContext& ctx) {
      return vendor::makeModule<vital::ChorusModule>(ctx.beatsPerSecond());
    };
    spec.needsBeatsPerSecond = true;
    return vendor::buildDescriptor(spec);
  }();
  return desc;
}

}  // namespace pg::modules

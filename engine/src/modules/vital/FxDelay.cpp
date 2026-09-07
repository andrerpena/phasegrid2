#include "delay_module.h"
#include "modules/vital/Effect.hpp"

namespace pg::modules {

/// fx.delay -- the vendored stereo delay, with a second (aux) time for ping-pong styles and a filter in the
/// feedback path. Frequency is a power of two in hertz, so it is the INVERSE of the delay time: 3 means 8 Hz,
/// i.e. a 125 ms delay.
const ModuleDescriptor& fxDelay() {
  static const ModuleDescriptor& desc = [] () -> const ModuleDescriptor& {
    vendor::ModuleSpec spec = effectSpec(
      "fx.delay", "Delay",
      "Stereo / ping-pong delay with a filtered feedback path. Frequency is a power of two in hertz and is "
      "the inverse of the delay time (3 = 8 Hz = 125 ms); Sync switches it to tempo divisions instead.",
      "delay", "Dry/wet delay output");
    spec.create = [](vendor::ModuleContext& ctx) {
      return vendor::makeModule<vital::DelayModule>(ctx.beatsPerSecond());
    };
    spec.needsBeatsPerSecond = true;
    return vendor::buildDescriptor(spec);
  }();
  return desc;
}

}  // namespace pg::modules

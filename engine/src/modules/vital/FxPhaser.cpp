#include "modules/vital/Effect.hpp"
#include "phaser_module.h"

namespace pg::modules {

/// fx.phaser -- the vendored phaser: a bank of all-pass stages swept around Center.
const ModuleDescriptor& fxPhaser() {
  static const ModuleDescriptor& desc = [] () -> const ModuleDescriptor& {
    vendor::ModuleSpec spec = effectSpec(
      "fx.phaser", "Phaser",
      "Phaser: all-pass stages swept around Center by their own oscillator. Center and Mod Depth are in "
      "semitones, Frequency is a power of two in hertz.",
      "phaser", "Dry/wet phaser output");
    spec.create = [](vendor::ModuleContext& ctx) {
      return vendor::makeModule<vital::PhaserModule>(ctx.beatsPerSecond());
    };
    spec.needsBeatsPerSecond = true;
    // Written once per block at buffer[0], like the flanger's rate readout.
    spec.outputs.push_back({"cutoff", "Cutoff", vital::PhaserModule::kCutoffOutput, SignalRole::Cv,
                            "Where the sweep left the all-pass cutoff at the end of the block, as a MIDI note",
                            /*firstFrameOnly=*/true});
    return vendor::buildDescriptor(spec);
  }();
  return desc;
}

}  // namespace pg::modules

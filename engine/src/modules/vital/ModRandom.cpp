#include <string>
#include "random_lfo_module.h"
#include "vital/Descriptors.hpp"

namespace pg::modules {

/// mod.random -- the vendored random modulator: perlin noise, sample & hold, interpolated sine or a Lorenz
/// attractor, all clocked by the same rate control. Output is 0..1.
///
/// Note the two similarly named controls the vendored module creates: `sync` chooses how the RATE is derived
/// (seconds, tempo divisions or key tracking), while `sync_type` is a plain on/off that locks the generator to
/// transport time so every voice hears the same stream.
const ModuleDescriptor& modRandom() {
  static const ModuleDescriptor& desc = [] () -> const ModuleDescriptor& {
    vendor::ModuleSpec spec;
    spec.id = "mod.random";
    spec.name = "Random";
    spec.category = "mod";
    spec.doc = "Random modulator: perlin, sample & hold, sine interpolation or a Lorenz attractor. Output is "
               "0..1. Frequency is a power of two in hertz (2 = 4 Hz) while Sync is Seconds.";
    spec.prefix = "random_1";
    spec.create = [](vendor::ModuleContext& ctx) {
      return vendor::makeModule<vital::RandomLfoModule>(std::string("random_1"), ctx.beatsPerSecond());
    };
    // No setControlRate() here on purpose: unlike the LFO, the vendored random module is built at audio rate
    // and does not forward setControlRate() to the generator inside it, so calling it would be a no-op that
    // reads as if it did something.
    spec.inputs = {
      {"gate", "Gate", vital::RandomLfoModule::kNoteTrigger, vendor::BindKind::Gate, SignalRole::Gate,
       "Gate: a rising edge draws a fresh pair of random values and restarts the ramp between them"},
      {"pitch", "Pitch", vital::RandomLfoModule::kMidi, vendor::BindKind::PitchAsMidi, SignalRole::Pitch,
       "Pitch the Keytrack sync mode tunes the rate to"},
    };
    spec.outputs = {{"out", "Out", 0, SignalRole::Cv, "The random signal, 0..1"}};
    spec.needsBeatsPerSecond = true;
    return vendor::buildDescriptor(spec);
  }();
  return desc;
}

}  // namespace pg::modules

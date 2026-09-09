#include <string>
#include "envelope_module.h"
#include "vital/Descriptors.hpp"

namespace pg::modules {

/// env.dahdsr -- the vendored envelope: delay, attack, hold, decay, sustain, release, each stage with its own
/// curve power. Built at audio rate so the envelope moves within a block rather than stepping once per block,
/// which matters as soon as it drives an audio-rate destination such as a filter cutoff or a VCA.
const ModuleDescriptor& envDahdsr() {
  static const ModuleDescriptor& desc = [] () -> const ModuleDescriptor& {
    vendor::ModuleSpec spec;
    spec.id = "env.dahdsr";
    spec.name = "Envelope";
    spec.category = "Modulation";
    spec.doc = "Delay/attack/hold/decay/sustain/release envelope. The gate holds it at the sustain level; "
               "a falling edge starts the release. Times are in seconds after the stage curve is applied.";
    spec.prefix = "env_1";
  spec.face = {"attack", "decay", "sustain", "release"};
    // The second argument forces audio rate: without it the envelope would follow whatever rate its parent
    // router runs at, and there is no parent router here.
    spec.create = [](vendor::ModuleContext&) { return vendor::makeModule<vital::EnvelopeModule>(std::string("env_1"), true); };
    spec.inputs = {
      {"gate", "Gate", vital::EnvelopeModule::kTrigger, vendor::BindKind::Gate, SignalRole::Gate,
       "Gate: a rising edge starts the envelope, a falling edge starts the release"},
    };
    spec.outputs = {
      {"out", "Out", vital::EnvelopeModule::kValue, SignalRole::Cv, "Envelope level, 0..1"},
      // The vendored envelope updates its phase once per block, at the end, so the adapter has to broadcast
      // that one value rather than copy a block the module never filled.
      {"phase", "Phase", vital::EnvelopeModule::kPhase, SignalRole::Phase,
       "Which stage the envelope is in, plus how far through it: 2.0 is the start of the attack, 2.5 halfway",
       /*firstFrameOnly=*/true},
    };
    return vendor::buildDescriptor(spec);
  }();
  return desc;
}

}  // namespace pg::modules

#include <string>
#include "core/Voices.hpp"
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
    // The envelope is what decides how long a voice lives after its note: the voice stays alive until
    // the release stage is over, unless the patch takes this envelope out of the decision. The vendored
    // envelope writes its stage into its phase output -- `kVoiceIdle` for the delay through `kVoiceOff`
    // for the release, each plus how far through -- and `kVoiceKill` once the release has run out;
    // before its first trigger it sits at `kInvalid`, which is not going either.
    spec.extraParams = {
      ParamDesc{"lifetime", "Affect voice lifetime", 0.f, 1.f, 1.f, ParamUnit::None, ParamCurve::Linear,
                kParamInteger | kParamNoSmooth, nullptr, 0, "toggle", nullptr,
                "Keep the voice alive until this envelope has finished its release. Off, the envelope still "
                "plays but has no say in when the voice ends"},
    };
    spec.alive = [](vital::SynthModule& m) -> Sample {
      const Sample phase = m.output(vital::EnvelopeModule::kPhase)->buffer[0];
      const vital::poly_mask going = vital::poly_float::greaterThanOrEqual(phase, static_cast<float>(vital::kVoiceIdle)) &
                                     vital::poly_float::lessThan(phase, static_cast<float>(vital::kVoiceKill));
      return Sample(1.f) & going;
    };
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

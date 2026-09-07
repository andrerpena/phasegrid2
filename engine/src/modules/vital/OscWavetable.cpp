#include <vector>
#include "oscillator_module.h"
#include "vital/Descriptors.hpp"
#include "vital/WavetableBank.hpp"

namespace pg::modules {
namespace {

/// Enum labels for the `table` param. Process lifetime, like everything else a descriptor points at.
const std::vector<const char*>& tableNames() {
  static const std::vector<const char*>* names = [] {
    auto* v = new std::vector<const char*>();
    for (uint32_t i = 0; i < vendor::WavetableBank::numBuiltins(); ++i) v->push_back(vendor::WavetableBank::builtinName(i));
    return v;
  }();
  return *names;
}

}  // namespace

/// osc.wavetable -- the vendored wavetable oscillator, with unison, phase distortion and spectral morphing.
/// The wavetable itself is a structural param: it is rendered on the message thread while the instance is
/// being built, so changing it rebuilds the instance rather than touching a running one.
const ModuleDescriptor& oscWavetable() {
  static const ModuleDescriptor& desc = [] () -> const ModuleDescriptor& {
    vendor::ModuleSpec spec;
    spec.id = "osc.wavetable";
    spec.name = "Wavetable Oscillator";
    spec.category = "osc";
    spec.doc = "Wavetable oscillator with unison, phase distortion and spectral morphing. Pitch is 0.1 per "
               "octave from middle C; the oscillator tracks it while Midi Track is on.";
    spec.prefix = "osc_1";
    spec.create = [](vendor::ModuleContext&) { return vendor::makeModule<vital::OscillatorModule>("osc_1"); };
    spec.inputs = {
      {"gate", "Gate", vital::OscillatorModule::kReset, vendor::BindKind::Gate, SignalRole::Gate,
       "Gate: a rising edge resets the oscillator phase and the envelopes on its own controls"},
      {"retrigger", "Retrigger", vital::OscillatorModule::kRetrigger, vendor::BindKind::Gate, SignalRole::Gate,
       "Gate: a rising edge restarts the wave without resetting the rest of the oscillator"},
      {"pitch", "Pitch", vital::OscillatorModule::kMidi, vendor::BindKind::PitchAsMidi, SignalRole::Pitch,
       "Pitch to play, 0.1 per octave from middle C"},
      {"voices", "Voices", vital::OscillatorModule::kActiveVoices, vendor::BindKind::ActiveVoices, SignalRole::Cv,
       "Which voice lanes exist; the oscillator uses it to spread unison across them"},
    };
    spec.outputs = {
      {"out", "Out", vital::OscillatorModule::kLevelled, SignalRole::Audio, "Audio after Level and Pan"},
      {"raw", "Raw", vital::OscillatorModule::kRaw, SignalRole::Audio, "Audio before Level and Pan"},
    };
    // A grid module is always on, and the 2D/3D editor view is a host UI control we have no use for. `view_2d`
    // also has to go: its range is 0..2 while its name table holds two entries, so exposing it would generate
    // a label off the end of that table.
    spec.hidden = {"on", "view_2d"};
  spec.face = {"level", "tune", "pan", "phase"};
    spec.extraParams = {
      ParamDesc{"table", "Wavetable", 0.f, static_cast<float>(tableNames().size() - 1), 0.f, ParamUnit::None,
                ParamCurve::Linear, kParamEnum | kParamInteger | kParamNoSmooth | kParamStructural,
                tableNames().data(), static_cast<uint32_t>(tableNames().size()), "select", nullptr,
                "Built-in wavetable this oscillator plays"},
    };
    spec.onConfigure = [](vital::SynthModule& m, vendor::ModuleContext&, const ParamValues& values) {
      auto it = values.find("table");
      const uint32_t index = it == values.end() ? 0u : static_cast<uint32_t>(it->second);
      vendor::WavetableBank::renderBuiltin(index, *static_cast<vital::OscillatorModule&>(m).getWavetable());
    };
    return vendor::buildDescriptor(spec);
  }();
  return desc;
}

}  // namespace pg::modules

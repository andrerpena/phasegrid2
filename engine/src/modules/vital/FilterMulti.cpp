#include "filter_module.h"
#include "vital/Descriptors.hpp"

namespace pg::modules {

/// filter.multi -- the vendored multi-model filter. One phasegrid module covers all eight models; the params
/// are generated from the vendored parameter table, so cutoff really is "MIDI note 8..136", exactly as the
/// underlying DSP defines it.
const ModuleDescriptor& filterMulti() {
  static const ModuleDescriptor& desc = [] () -> const ModuleDescriptor& {
    vendor::ModuleSpec spec;
    spec.id = "filter.multi";
    spec.name = "Filter";
    spec.category = "Filters";
    spec.doc = "Multi-model filter: analog, dirty, ladder, digital, diode, formant, comb, phaser. "
               "Cutoff is a MIDI note number, so a semitone of modulation is a semitone of cutoff.";
    spec.prefix = "filter_1";
    spec.create = [](vendor::ModuleContext&) { return vendor::makeModule<vital::FilterModule>("filter_1"); };
    // A grid module is always on -- there is no bypass knob, so the module never creates its `_on` control.
    spec.configure = [](vital::SynthModule& m) { static_cast<vital::FilterModule&>(m).setCreateOnValue(false); };
    spec.inputs = {
      {"in", "In", vital::FilterModule::kAudio, vendor::BindKind::Audio, SignalRole::Audio, "Audio input"},
      {"reset", "Reset", vital::FilterModule::kReset, vendor::BindKind::Gate, SignalRole::Gate,
       "Gate: a rising edge resets the filter state"},
      {"pitch", "Pitch", vital::FilterModule::kMidi, vendor::BindKind::PitchAsMidi, SignalRole::Pitch,
       "Pitch the comb model tunes to"},
      {"keytrack", "Key Track", vital::FilterModule::kKeytrack, vendor::BindKind::KeytrackOffset, SignalRole::Pitch,
       "Pitch for key tracking: semitones from middle C, scaled by the Key Track amount"},
    };
    spec.outputs = {{"out", "Out", 0, SignalRole::Audio, "Filtered audio"}};
    spec.hidden = {"on"};
  spec.face = {"cutoff", "resonance", "drive", "mix"};
    spec.overrides = {
      // `style` means something different in every model (12dB/24dB for the analog and digital models, a
      // shelf choice for the diode model, a comb topology for the comb model, ...) and the vendored name
      // table only covers the first of those, so it is exposed as a plain index rather than a labelled enum.
      vendor::ControlOverride{.control = "style",
                              .doc = "Filter style; the meaning depends on Model (0..4 name the analog and "
                                     "digital shapes: 12dB, 24dB, Notch Blend, Notch Spread, B/P/N)",
                              .suppressLabels = true},
    };
    return vendor::buildDescriptor(spec);
  }();
  return desc;
}

}  // namespace pg::modules

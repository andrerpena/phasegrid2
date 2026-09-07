#include "sample_module.h"
#include "vital/Descriptors.hpp"

namespace pg::modules {

/// sampler.player -- the vendored sample player: a band-limited, optionally looping and bouncing playback
/// head with transpose, tune, level and pan. Until an asset is loaded it plays the content the vendored
/// sample is born with, a second of white noise, so the module is audible the moment it is placed.
///
/// The vendored module hard-codes its control names as `sample_*` rather than taking a prefix argument the
/// way the oscillator and the filter do, but the prefix is still there in the names, so the spec declares it
/// and the generated param ids come out as the bare suffixes (`level`, not `sample_level`).
const ModuleDescriptor& samplerPlayer() {
  static const ModuleDescriptor& desc = [] () -> const ModuleDescriptor& {
    vendor::ModuleSpec spec;
    spec.id = "sampler.player";
    spec.name = "Sampler";
    spec.category = "osc";
    spec.doc = "Plays a sample. A rising gate restarts it; Loop and Bounce decide what happens at the end. "
               "Pitch only moves it while Keytrack is on. With no asset loaded it plays white noise.";
    spec.prefix = "sample";
    spec.create = [](vendor::ModuleContext& ctx) {
      auto* m = vendor::makeModule<vital::SampleModule>();
      // Hand the instance's sample to the adapter's context so a future asset load has something to write
      // into. Nothing else here owns it: it lives inside the vendored source, behind a shared_ptr.
      ctx.sample = m->getSample();
      return m;
    };
    spec.inputs = {
      {"gate", "Gate", vital::SampleModule::kReset, vendor::BindKind::Gate, SignalRole::Gate,
       "Gate: a rising edge restarts playback from the beginning"},
      {"pitch", "Pitch", vital::SampleModule::kMidi, vendor::BindKind::PitchAsMidi, SignalRole::Pitch,
       "Pitch to play at, 0.1 per octave from middle C. Only used while Keytrack is on"},
      {"count", "Note Count", vital::SampleModule::kNoteCount, vendor::BindKind::NoteCount, SignalRole::Cv,
       "How many notes are held; the vendored player encodes it into its phase readout"},
    };
    // Both outputs are written for the whole block by the vendored source, so neither needs firstFrameOnly.
    // The player's third readout, its phase, is not one of the module's own outputs (it hangs off the source
    // inside), so there is no output index to expose it through.
    spec.outputs = {
      {"out", "Out", vital::SampleModule::kLevelled, SignalRole::Audio, "Audio after Level and Pan"},
      {"raw", "Raw", vital::SampleModule::kRaw, SignalRole::Audio, "Audio before Level and Pan"},
    };
    // A grid module is always on: on the grid you bypass a sampler by unplugging it. The vendored switch
    // still has to be turned on, because it defaults to off and gates the whole `process()`.
    spec.hidden = {"on"};
  spec.face = {"level", "tune", "pan"};
    spec.postInit = [](vital::SynthModule& m) { m.getControls()["sample_on"]->set(1.0f); };
    spec.overrides = {
      // 0..8191 is a bit field of the twelve pitch classes plus a global/local flag, not a step count, so it
      // gets no labels and a doc line that says what the number means.
      vendor::ControlOverride{"transpose_quantize", 0, "Bit field of the pitch classes Transpose snaps to; "
                              "0 does not snap. Bits 0-11 are the twelve notes, bit 12 quantizes globally"},
    };
    return vendor::buildDescriptor(spec);
  }();
  return desc;
}

}  // namespace pg::modules

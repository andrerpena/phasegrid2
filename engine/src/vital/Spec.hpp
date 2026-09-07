#pragma once
#include <functional>
#include <map>
#include <memory>
#include <string>
#include <vector>
#include "core/Descriptor.hpp"
#include "core/Module.hpp"
#include "line_generator.h"
#include "processor.h"
#include "sample_source.h"
#include "synth_module.h"

/// Adapter layer over the vendored DSP library in engine/vendor/vital: it turns one of that library's
/// `SynthModule` subclasses into a phasegrid `Module`, with the phasegrid descriptor generated from the
/// library's own parameter table. Nothing here is specific to a single module; a concrete module is a
/// `ModuleSpec` value; see the module files that declare one.
namespace pg::vendor {

/// How the adapter drives one vendored input from one phasegrid port.
enum class BindKind {
  Audio,           // full-rate signal, bound straight through (zero copy)
  Gate,            // full-rate signal, plus trigger events derived from its edges
  PitchAsMidi,     // pitch (0.1/octave) converted to a MIDI note per sample
  ConstMidi,       // control-rate: the block's first frame as a MIDI note
  KeytrackOffset,  // control-rate: MIDI note minus middle C, in semitones
  NoteCount,       // control-rate: how many notes are held (1 in this milestone)
  ActiveVoices,    // control-rate: 1 on the lanes of voices that exist, 0 elsewhere
};

/// One phasegrid input port and the vendored input index it feeds (-1 = not plugged; used by effects that
/// take their audio through `processWithInput`).
struct InputMap {
  const char* id;
  const char* name;
  int vendorInput;
  BindKind kind;
  SignalRole role;
  const char* doc;
};

struct OutputMap {
  const char* id;
  const char* name;
  int vendorOutput;
  SignalRole role;
  const char* doc;
};

/// Per-control tweaks applied after a param has been generated from the vendored parameter table.
/// `exposeNonParameter` emits a control that the table does not describe (e.g. the `_sync` values a tempo
/// sync switch creates) using the range and labels given here.
struct ControlOverride {
  std::string control;              // control suffix, e.g. "sync"
  uint32_t addFlags = 0;
  const char* doc = nullptr;
  bool exposeNonParameter = false;
  float min = 0.f, max = 1.f, def = 0.f;
  const std::string* labels = nullptr;
  uint32_t labelCount = 0;
  /// Set when the vendored table gives this control a `string_lookup` that is SHORTER than its own
  /// min..max range -- which happens whenever the names depend on a second control (a filter's `style`
  /// is named differently per `model`). The generator would otherwise read off the end of that array,
  /// so such a control is emitted as a plain integer with no labels.
  bool suppressLabels = false;
};

/// Objects a vendored module may need that belong to the phasegrid instance rather than to the module:
/// owned by the adapter, handed to `ModuleSpec::create`.
class ModuleContext {
public:
  LineGenerator& lineGenerator() {
    if (!line_) line_ = std::make_unique<LineGenerator>();
    return *line_;
  }
  /// A control-rate output the adapter refreshes with tempo/60 every block when `needsBeatsPerSecond`.
  vital::cr::Output* beatsPerSecondOutput() {
    if (!bps_) {
      bps_ = std::make_unique<vital::cr::Output>();
      bps_->buffer[0] = vital::poly_float(2.f);
    }
    return bps_.get();
  }
  const vital::Output* beatsPerSecond() { return beatsPerSecondOutput(); }

  vital::Sample* sample = nullptr;   // set by sampler specs after create

private:
  std::unique_ptr<LineGenerator> line_;
  std::unique_ptr<vital::cr::Output> bps_;
};

/// Everything that distinguishes one vendored-backed module type from another. A module file declares one
/// of these and hands it to `buildDescriptor`.
struct ModuleSpec {
  const char* id = nullptr;
  const char* name = nullptr;
  const char* category = nullptr;
  const char* doc = nullptr;
  std::string prefix;                                                    // "filter_1"; "" for fixed-id modules
  std::function<vital::SynthModule*(ModuleContext&)> create;             // construct (not init)
  std::function<void(vital::SynthModule&)> configure;                    // optional, before init(): setMono, ...
  std::function<void(vital::SynthModule&, const ParamValues&)> onConfigure;   // optional, before init(): structural params
  std::function<void(vital::SynthModule&)> postInit;                     // optional, after init()
  std::vector<InputMap> inputs;
  std::vector<OutputMap> outputs;
  std::vector<ParamDesc> extraParams;                                    // emitted BEFORE generated params; no vendored control
  std::vector<std::string> hidden;                                       // control suffixes not exposed
  std::vector<ControlOverride> overrides;
  bool processWithInput = false;   // effects: audio via processWithInput(buffer, n); input 0 must be Audio with vendorInput -1
  bool needsBeatsPerSecond = false;
  uint32_t moduleFlags = 0;
};

inline std::string controlName(const ModuleSpec& s, const std::string& suffix) {
  return s.prefix.empty() ? suffix : s.prefix + "_" + suffix;
}
inline std::string controlSuffix(const ModuleSpec& s, const std::string& full) {
  return s.prefix.empty() ? full : full.substr(s.prefix.size() + 1);
}

}  // namespace pg::vendor

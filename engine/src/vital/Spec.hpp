#pragma once
#include <functional>
#include <map>
#include <memory>
#include <string>
#include <type_traits>
#include <utility>
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
  /// Set when the vendored module writes only `buffer[0]` of this output even though the Output itself is
  /// full size (the envelope's phase output is like that: `Envelope::processAudioRate` fills the value
  /// buffer per sample but writes the phase once at the end). Without this the adapter would copy a block
  /// of samples the module never wrote. The adapter broadcasts frame 0 across the block instead.
  bool firstFrameOnly = false;
};

/// A vendored `SynthModule` subclass whose processing order is the sorted one.
///
/// The vendored router keeps two copies of its order: `global_order_`, which every `plug()` re-sorts
/// topologically, and `local_order_`, which is what `process()` actually runs. `local_order_` is only
/// rebuilt from `global_order_` when the router's local change counter disagrees with the shared global
/// one -- and on the object that owns the graph the two always move together, so the rebuild never
/// happens and `process()` runs things in the order they were *added*. Upstream never notices because it
/// processes per-voice COPIES of the router, and the copy constructor builds `local_order_` from the
/// sorted `global_order_`. We process the router itself.
///
/// The difference is visible whenever a module plugs a processor before creating the controls that feed
/// it: the vendored envelope adds its envelope processor in its constructor and creates its controls in
/// `init()`, so the envelope runs first and reads every control one block late -- and on the first block
/// reads zero, i.e. a zero attack time, i.e. an instant attack. Bumping the shared counter once makes the
/// next `updateAllProcessors()` do its work; after that the two counters agree again and nothing further
/// happens at run time.
template <class Vendored>
class Sorted final : public Vendored {
public:
  using Vendored::Vendored;
  /// Some vendored modules hold `Output`s by value (the chorus keeps one per delay pair), which deletes their
  /// copy constructor; those declare `clone()` as an assertion. Match that instead of failing to compile.
  vital::Processor* clone() const override {
    if constexpr (std::is_copy_constructible_v<Vendored>) return new Sorted(*this);
    else return nullptr;
  }
  void init() override {
    Vendored::init();
    ++(*this->global_changes_);
    this->updateAllProcessors();
  }
};

/// Constructs a vendored module that runs in sorted order. Every `ModuleSpec::create` should use this
/// rather than `new` -- for a module that was already in a safe order it costs one rebuild at prepare time.
/// Returns the derived type, not `vital::SynthModule*`, so a spec that has to reach a member the base does
/// not declare (the sampler's `getSample()`) can do it without a cast; it converts to what `create` returns.
template <class Vendored, class... Args>
Sorted<Vendored>* makeModule(Args&&... args) {
  return new Sorted<Vendored>(std::forward<Args>(args)...);
}

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
  /// Optional, before init(): applies structural params. Takes the context too, because a structural choice may
  /// belong to something the context owns rather than to the module (the LFO's shape lives in its line source).
  std::function<void(vital::SynthModule&, ModuleContext&, const ParamValues&)> onConfigure;
  std::function<void(vital::SynthModule&)> postInit;                     // optional, after init()
  std::vector<InputMap> inputs;
  std::vector<OutputMap> outputs;
  std::vector<ParamDesc> extraParams;                                    // emitted BEFORE generated params; no vendored control
  std::vector<std::string> hidden;                                       // control suffixes not exposed
  /// Control suffixes that belong on the module's face: the handful an interface shows without being
  /// asked. Everything else stays reachable through the inspector. See `kParamPrimary`.
  std::vector<std::string> face;
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

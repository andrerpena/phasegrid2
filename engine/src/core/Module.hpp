#pragma once
#include <cstdint>
#include <map>
#include <nlohmann/json_fwd.hpp>
#include <string>
#include <vector>
#include "core/Conventions.hpp"
#include "core/Descriptor.hpp"
#include "core/Event.hpp"
#include "core/Param.hpp"
#include "core/Signal.hpp"
#include "core/TelemetryChannel.hpp"

namespace pg {

/// Model param values by param id, in display units. What `NodeModel::params` carries.
using ParamValues = std::map<std::string, float>;

/// Structured per-node state that no param can express -- a clip's notes, a curve's breakpoints. What
/// `NodeModel::data` carries: an arbitrary JSON object, owned by the patch document so it undoes with the
/// rest of it. Always an object, empty when the node has none. Message thread only.
using NodeData = nlohmann::json;

/// A text property's value out of the node's data, or its declared default.
///
/// Anything but a string of a sensible length reads as the default rather than throwing: this runs
/// on the message thread inside a compile, and `data` is whatever was in the patch file. A module
/// that wants to be strict about the CONTENT is free to be -- that is its own business, and it is
/// what `notes.pattern` does with a pattern it cannot parse.
std::string textProperty(const NodeData& data, const char* key, const char* fallback);

/// What one node is prepared for. `voiceCount` is the NODE's: the voices of the instrument it belongs
/// to, or 1 for a global node, which is why a global LFO holds one state and an oscillator inside a
/// sixteen-voice instrument holds eight pairs of it.
struct PrepareInfo {
  double sampleRate = 48000.0;
  uint32_t maxBlock = kMaxBlockSize;
  uint32_t voiceCount = 1;
  bool operator==(const PrepareInfo&) const = default;
};

/// The project's global clock, as every module sees it: `ProcessContext::transport`.
///
/// `ppq` counts quarter notes, which is the unit the tempo is in, so it is meter-independent on purpose --
/// a module that wants bars asks the meter for them rather than assuming four. `samplePos` is engine time
/// and free-runs whether or not the transport is rolling, so a patch still moves while nothing is playing.
struct TransportSnapshot {
  double tempo = 120.0;
  bool playing = false;
  double ppq = 0.0;
  uint64_t samplePos = 0;
  /// Time signature: beats per bar over the note value that gets the beat (4/4, 6/8, 7/8...).
  uint32_t timeSigNumerator = 4;
  uint32_t timeSigDenominator = 4;
  /// The project's key and scale, for the modules that snap or generate pitch: `notefx.quantize` and
  /// its kin. `scaleRoot` is a pitch class, 0 for C. `scaleMask` has bit k set when the semitone k
  /// above the root is in the scale, so the default, every bit, is chromatic and passes everything.
  /// A mask rather than a name, so the engine never has to know what "dorian" means.
  uint32_t scaleRoot = 0;
  uint32_t scaleMask = 0xFFFu;

  /// Is this MIDI note number's pitch class in the scale?
  bool inScale(int midi) const {
    const int k = ((midi - static_cast<int>(scaleRoot)) % 12 + 12) % 12;
    return (scaleMask >> k) & 1u;
  }

  /// Quarter notes in one bar, which is what turns `ppq` into bars: 4/4 is 4, 6/8 is 3, 7/8 is 3.5.
  double quartersPerBar() const {
    return timeSigDenominator == 0 ? 4.0 : 4.0 * static_cast<double>(timeSigNumerator) / static_cast<double>(timeSigDenominator);
  }
  /// Quarter notes in one beat: the denominator's note value. 4/4 is 1, 6/8 is 0.5.
  double quartersPerBeat() const {
    return timeSigDenominator == 0 ? 1.0 : 4.0 / static_cast<double>(timeSigDenominator);
  }
};

/// Engine output for the current block (stereo lanes per voice). Terminal modules ADD into it.
struct AudioBus {
  Sample* data = nullptr;
  uint32_t frames = 0;
};

class TelemetryWriter;
class VoiceActivity;

/// Built by the scheduler per Process op. Port indices are the descriptor's declared indices.
///
/// A global module runs once per block: `voice` is 0, `firstPass` and `lastPass` are both true, the
/// mask is voice 0's lanes and `activity` is null. A module inside an instrument runs once per LIVE
/// voice pair, in ascending pair order: `voice` is the pair, the mask has the lanes of the pair's
/// voices that are not free, `firstPass` marks the first pair run this block and `lastPass` the last,
/// and `activity` is the instrument's pool. Work that is the same for every voice belongs on the first
/// pass; a fold that sums the voices clears on the first and publishes on the last.
struct ProcessContext {
  uint32_t numFrames = 0;
  uint32_t voice = 0;                 // voice PAIR index
  bool firstPass = true;
  bool lastPass = true;
  Mask voiceMask = Mask(static_cast<uint32_t>(-1));   // lanes of voices that exist in this pair
  VoiceActivity* activity = nullptr;
  /// Where a `kModuleWritesTelemetry` module publishes what it draws about itself, or null and
  /// `kNoTelemetrySlotCtx` when nobody is watching that channel. This slot is the module's alone: the
  /// parameter values the scheduler publishes for the same module go to a different one, so a module
  /// with a picture AND modulated knobs shows both. Assigned by `telemetry.subscribe` rather than by
  /// the compiler, so subscribing does not recompile the graph and cannot glitch the audio.
  TelemetryWriter* telemetry = nullptr;
  uint32_t displaySlot = kNoTelemetrySlotCtx;
  double sampleRate = 48000.0;
  const TransportSnapshot* transport = nullptr;
  AudioBus* outputBus = nullptr;
  const SignalView* inputs = nullptr;               // [numDeclaredInputs]; empty view for event ports / unconnected
  const SignalView* outputs = nullptr;              // [numOutputs]
  const EventBuffer* const* eventInputs = nullptr;  // [numDeclaredInputs]
  EventBuffer* const* eventOutputs = nullptr;       // [numOutputs]
  const ParamView* params = nullptr;                // [numParams]

  const SignalView& in(uint32_t p) const { return inputs[p]; }
  const SignalView& out(uint32_t p) const { return outputs[p]; }
  const EventBuffer& eventIn(uint32_t p) const { return *eventInputs[p]; }
  EventBuffer& eventOut(uint32_t p) const { return *eventOutputs[p]; }
  ParamView param(uint32_t i) const { return params[i]; }
};

class Module {
public:
  virtual ~Module() = default;
  /// Message thread, once, before `prepare`: the model's param values and structured data for this
  /// instance. A module that declares `kParamStructural` params reads them here, because such a param can
  /// only take effect while the instance is being built; node data is structural for the same reason, and
  /// is compared the same way. Never called again — `InstanceTable::acquire` rebuilds instead, and the
  /// rebuilt instance hears about the one it replaced through `adopt`.
  virtual void configure(const ParamValues&, const NodeData&) {}
  virtual void prepare(const PrepareInfo&) = 0;   // message thread; the only place to allocate
  /// Audio thread, at the swap that makes this instance current, when it was built to REPLACE one: the
  /// same node id and module type, rebuilt because its node data, a `kParamStructural` param or its voice
  /// count changed. `retiring` is the instance that ran until this block and will never run again, so
  /// this is the one chance to carry over what it was in the middle of. A module that emits events copies
  /// the notes it has opened and not yet closed, so the note offs come from the instance that goes on
  /// running; without that every held note downstream is stuck the moment a pattern is edited. Same
  /// rules as `process`, and copy rather than move, bounded by this instance's own sizes: the swap can be
  /// retried, in which case this runs again with the retiring instance one block further on. The default
  /// carries nothing, which is right for a module whose state is a picture or a filter.
  virtual void adopt(const Module& /*retiring*/) {}
  /// Audio thread. Called by the scheduler on every module of an instrument when a voice pair that
  /// was dead comes back to life, before the pair runs, so a new note starts from clean DSP state
  /// rather than from whatever the last note left in a filter or a delay line. Same rules as
  /// `process`: no allocation, no locks, no syscalls. A stolen voice inside a live pair is not reset;
  /// it retriggers through the one-frame gate dip `note.toPoly` emits, as a downstream envelope expects.
  virtual void reset(uint32_t /*voicePair*/) {}
  /// Audio thread, `kModuleVoiceEntry` modules only: once per block, before the instrument's voice
  /// passes, with the module's event inputs bound. Reads the block's note events and decides which
  /// voice each goes to, marking the instrument's `VoiceActivity`; `process` then replays the
  /// decisions for each pair it is run for.
  virtual void allocate(ProcessContext&) {}
  virtual void process(ProcessContext&) = 0;      // audio thread; no alloc/lock/IO/exceptions
  /**
   * One cycle of the waveform this module would produce at `params`, written as `count` samples in
   * -1..1, for an interface to draw. Message thread, never the audio thread: it may be as slow and as
   * allocating as it likes, and it must not touch DSP state the audio thread is using.
   *
   * Returns false when the module has no such picture, which is what the default does. A module that
   * returns true declares `kModulePreviewsWave` so an interface knows to ask. The picture is computed
   * from the same parameters the sound is, by the module that makes the sound, which is the only way
   * to keep the two from drifting apart.
   */
  virtual bool preview(const ParamValues& /*params*/, float* /*out*/, uint32_t /*count*/) { return false; }
};

/**
 * The envelope picture: what a `kModulePreviewsEnvelope` module writes through `Module::preview`
 * instead of a cycle of a wave, and what the `adsr` block on its face draws.
 *
 * Same call, same buffer, different kind on the wire (`TelemetryKind::Envelope`), because an envelope
 * is not one cycle of anything: it is four segments whose widths are its own times, a level to hold at,
 * and a place it has got to. A reader that only had samples could draw the curve but not say where the
 * decay ends, so it could not dash the sustain or put a dot on a corner.
 *
 * `x` is a fraction of the drawn width and `y` a level in 0..1, so the block scales the picture to its
 * own rectangle and knows nothing about seconds. The curve is evenly spaced across the whole width.
 */
inline constexpr uint32_t kEnvelopePictureHeader = 8;
enum EnvelopePictureField : uint32_t {
  kEnvelopeAttackEnd = 0,   ///< x where the attack reaches full scale
  kEnvelopeDecayEnd,        ///< x where the decay reaches the sustain level; the dashed run starts here
  kEnvelopeSustainEnd,      ///< x where the release begins; the dashed run ends here
  kEnvelopeSustainLevel,    ///< the sustain level, 0..1
  kEnvelopePlayheadX,       ///< where the envelope has got to, or -1 when it is not running
  kEnvelopePlayheadY,       ///< the level it is at
  kEnvelopeStage,           ///< which stage it is in, as `vital::VoiceEvent`
  kEnvelopeReserved,
};

/// Keeps all mutable DSP state in one State struct per voice pair.
template <class State>
class VoicedModule : public Module {
public:
  void prepare(const PrepareInfo& p) final {
    states_.assign((p.voiceCount + 1) / 2, State{});
    info_ = p;
    onPrepare(p);
  }
  void reset(uint32_t voicePair) override { states_[voicePair] = State{}; }
protected:
  virtual void onPrepare(const PrepareInfo&) {}
  State& st(const ProcessContext& c) { return states_[c.voice]; }
  const PrepareInfo& info() const { return info_; }
private:
  std::vector<State> states_;
  PrepareInfo info_{};
};

}  // namespace pg

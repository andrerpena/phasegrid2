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

namespace pg {

/// Model param values by param id, in display units. What `NodeModel::params` carries.
using ParamValues = std::map<std::string, float>;

/// Structured per-node state that no param can express -- a clip's notes, a curve's breakpoints. What
/// `NodeModel::data` carries: an arbitrary JSON object, owned by the patch document so it undoes with the
/// rest of it. Always an object, empty when the node has none. Message thread only.
using NodeData = nlohmann::json;

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
inline constexpr uint32_t kNoTelemetrySlotCtx = 0xFFFFFFFFu;

/// Built by the scheduler per Process op. Port indices are the descriptor's declared indices.
struct ProcessContext {
  uint32_t numFrames = 0;
  uint32_t voice = 0;                 // voice PAIR index
  uint32_t voicePairs = 1;            // how many pairs this program runs, so a module can tell it is last
  Mask voiceMask = Mask(static_cast<uint32_t>(-1));   // lanes of voices that exist in this pair
  /// Where a `kModuleWritesTelemetry` module publishes, or null and `kNoTelemetrySlot` when nobody is
  /// watching. Assigned by `telemetry.subscribe` rather than by the compiler, so subscribing does not
  /// recompile the graph and cannot glitch the audio.
  TelemetryWriter* telemetry = nullptr;
  uint32_t telemetrySlot = kNoTelemetrySlotCtx;
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
  /// is compared the same way. Never called again — `InstanceTable::acquire` rebuilds instead.
  virtual void configure(const ParamValues&, const NodeData&) {}
  virtual void prepare(const PrepareInfo&) = 0;   // message thread; the only place to allocate
  /// RESERVED, and CALLED BY NOTHING TODAY. Not the scheduler, not `Engine::renderBlock`, not the program
  /// swap: implementing it gets you silence rather than behaviour, so never reach for it to clear per-voice
  /// state. There are already two answers for that and they cover what the engine can currently ask for.
  /// A stolen voice retriggers through the one-frame gate dip `note.toPoly` emits, which is the right
  /// modular answer -- a downstream envelope sees an edge like any other. Everything else resets by being
  /// built again: `InstanceTable::acquire` makes a fresh instance whenever the sample rate, the voice count,
  /// a `kParamStructural` param or the node data changes. It stays declared because a transport-level panic
  /// or an explicit voice-reset command is the one thing that would need it, and because `VoicedModule` and
  /// the vendored adapter already implement it correctly for when that lands. Do not invent a caller to
  /// make it used. Kept in sync with the note in docs/engine.md.
  virtual void reset(uint32_t /*voicePair*/) {}
  virtual void process(ProcessContext&) = 0;      // audio thread; no alloc/lock/IO/exceptions
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

#pragma once
#include <cstdint>
#include <vector>
#include "core/Conventions.hpp"
#include "core/Descriptor.hpp"
#include "core/Event.hpp"
#include "core/Param.hpp"
#include "core/Signal.hpp"

namespace pg {

struct PrepareInfo {
  double sampleRate = 48000.0;
  uint32_t maxBlock = kMaxBlockSize;
  uint32_t voiceCount = 1;
  bool operator==(const PrepareInfo&) const = default;
};

struct TransportSnapshot {
  double tempo = 120.0;
  bool playing = false;
  double ppq = 0.0;
  uint64_t samplePos = 0;
};

/// Engine output for the current block (stereo lanes per voice). Terminal modules ADD into it.
struct AudioBus {
  Sample* data = nullptr;
  uint32_t frames = 0;
};

struct TelemetrySlot;  // phase 5

/// Built by the scheduler per Process op. Port indices are the descriptor's declared indices.
struct ProcessContext {
  uint32_t numFrames = 0;
  uint32_t voice = 0;                 // voice PAIR index
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
  virtual void prepare(const PrepareInfo&) = 0;   // message thread; the only place to allocate
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

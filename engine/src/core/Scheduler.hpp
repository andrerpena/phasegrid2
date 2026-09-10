#pragma once
#include <array>
#include "core/Program.hpp"
#include "rt/RtAssert.hpp"

namespace pg {

/// Executes a Program segment by segment: a global segment once, an instrument segment once per live
/// voice pair. Audio-thread safe after construction.
class Scheduler {
public:
  void run(Program& p, uint32_t numFrames, const TransportSnapshot& t, AudioBus* bus,
           TelemetryWriter* telemetry = nullptr) noexcept PG_RT_NONBLOCKING;
private:
  /// One pass over a segment's ops: which pair, with which lanes, and where in the block's passes it sits.
  struct Pass {
    uint32_t pair = 0;
    Mask mask = Program::globalMask();
    bool first = true;
    bool last = true;
    VoiceActivity* activity = nullptr;
  };
  void runSegment(Program& p, const Segment& seg, uint32_t numFrames, const Pass& pass, const TransportSnapshot& t,
                  AudioBus* bus, TelemetryWriter* telemetry);
  void exec(Program& p, const Op& op, uint32_t offset, uint32_t n, const Pass& pass, const TransportSnapshot& t, AudioBus* bus,
            TelemetryWriter* telemetry);
  void runCluster(Program& p, size_t first, uint32_t count, uint32_t numFrames, const Pass& pass, const TransportSnapshot& t, AudioBus* bus,
                  TelemetryWriter* telemetry);
  /// Binds a node's ports and params into a context for the pass. Shared by Process and Allocate.
  void bind(Program& p, NodeSlot& slot, uint32_t offset, uint32_t n, const Pass& pass, const TransportSnapshot& t, AudioBus* bus,
            TelemetryWriter* telemetry, ProcessContext& ctx, AudioBus& busSlice);
  static SignalView view(Program& p, uint32_t buf, uint32_t offset, uint32_t n) { return SignalView{p.buffers[buf].data.data() + offset, n}; }

  std::array<SignalView, kMaxPortsPerModule> in_{}, out_{};
  std::array<const EventBuffer*, kMaxPortsPerModule> evIn_{};
  std::array<EventBuffer*, kMaxPortsPerModule> evOut_{};
  std::array<ParamView, kMaxParamsPerModule> params_{};
  /// Scratch for the values a subscribed module publishes; sized once so publishing allocates nothing.
  std::array<float, kMaxParamsPerModule> paramValues_{};
  /// Blocks run so far, stamped on every params slot so a reader can tell fresh from stale.
  uint64_t blockIndex_ = 0;
  EventBuffer emptyEvents_;
};

}  // namespace pg

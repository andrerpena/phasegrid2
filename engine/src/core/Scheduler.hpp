#pragma once
#include <array>
#include "core/Program.hpp"
#include "rt/RtAssert.hpp"

namespace pg {

/// Executes a Program's op list once per voice pair. Audio-thread safe after construction.
class Scheduler {
public:
  void run(Program& p, uint32_t numFrames, const TransportSnapshot& t, AudioBus* bus) noexcept PG_RT_NONBLOCKING;
private:
  void exec(Program& p, const Op& op, uint32_t offset, uint32_t n, uint32_t pair, const TransportSnapshot& t, AudioBus* bus);
  void runCluster(Program& p, size_t first, uint32_t count, uint32_t numFrames, uint32_t pair, const TransportSnapshot& t, AudioBus* bus);
  static SignalView view(Program& p, uint32_t buf, uint32_t offset, uint32_t n) { return SignalView{p.buffers[buf].data.data() + offset, n}; }

  std::array<SignalView, kMaxPortsPerModule> in_{}, out_{};
  std::array<const EventBuffer*, kMaxPortsPerModule> evIn_{};
  std::array<EventBuffer*, kMaxPortsPerModule> evOut_{};
  std::array<ParamView, kMaxParamsPerModule> params_{};
  EventBuffer emptyEvents_;
};

}  // namespace pg

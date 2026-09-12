#pragma once
#include "common.h"
#include "core/Signal.hpp"
#include "processor.h"

namespace pg::vendor {

/// Turns a continuous gate into trigger events on `out` for this block: per lane, the LAST edge in the block
/// wins, because the vendored framework carries exactly one trigger per lane per block. Rising edge (> 0)
/// becomes kVoiceOn, falling edge becomes kVoiceOff, and `lastGate` carries the final level into the next
/// block so an edge across a block boundary is still seen. Audio thread: no allocation, no branching on state.
inline void deriveTriggers(const Sample* gate, uint32_t n, Sample& lastGate, vital::Output& out) {
  out.clearTrigger();
  float prev[4] = {lastGate[0], lastGate[1], lastGate[2], lastGate[3]};
  int lastOffset[4] = {-1, -1, -1, -1};
  float lastValue[4] = {0.f, 0.f, 0.f, 0.f};
  for (uint32_t i = 0; i < n; ++i) {
    for (int lane = 0; lane < 4; ++lane) {
      const float g = gate[i][static_cast<size_t>(lane)];
      const bool wasHigh = prev[lane] > 0.f, isHigh = g > 0.f;
      if (isHigh != wasHigh) {
        lastOffset[lane] = static_cast<int>(i);
        lastValue[lane] = static_cast<float>(isHigh ? vital::kVoiceOn : vital::kVoiceOff);
      }
      prev[lane] = g;
    }
  }
  lastGate = Sample(prev[0], prev[1], prev[2], prev[3]);
  for (int lane = 0; lane < 4; ++lane) {
    if (lastOffset[lane] < 0) continue;
    uint32_t m[4] = {0, 0, 0, 0};
    m[lane] = static_cast<uint32_t>(-1);
    // Output::trigger merges per lane with maskLoad, so one call per lane composes into one event set.
    out.trigger(vital::poly_mask(m[0], m[1], m[2], m[3]), Sample(lastValue[lane]),
                vital::poly_int(static_cast<uint32_t>(lastOffset[lane])));
  }
}

}  // namespace pg::vendor

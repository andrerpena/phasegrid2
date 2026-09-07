#pragma once
#include <cstdint>

namespace pg::test {
/// While an RtScope is alive on this thread, every global operator new/delete increments the violation counter.
struct RtScope {
  RtScope();
  ~RtScope();
  RtScope(const RtScope&) = delete;
  RtScope& operator=(const RtScope&) = delete;
};
uint64_t rtViolations();
void resetRtViolations();
}  // namespace pg::test

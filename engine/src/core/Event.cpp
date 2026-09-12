#include "core/Event.hpp"

namespace pg {
void mergeEvents(const EventBuffer* const* sources, uint32_t numSources, EventBuffer& dst) {
  dst.clear();
  std::array<uint32_t, kMaxPortsPerModule> heads{};
  const uint32_t n = numSources < kMaxPortsPerModule ? numSources : kMaxPortsPerModule;
  for (;;) {
    int best = -1; uint32_t bestFrame = 0;
    for (uint32_t s = 0; s < n; ++s) {
      if (heads[s] >= sources[s]->size()) continue;
      const uint32_t f = (*sources[s])[heads[s]].frame;
      if (best < 0 || f < bestFrame) { best = static_cast<int>(s); bestFrame = f; }
    }
    if (best < 0) return;
    if (!dst.push((*sources[best])[heads[best]])) return;
    ++heads[best];
  }
}
}  // namespace pg

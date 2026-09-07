#pragma once
#include <array>
#include <cstdint>
#include "core/Conventions.hpp"

namespace pg {

namespace lanes {
inline Mask voice(uint32_t v) { return v == 0 ? Mask(-1, -1, 0, 0) : Mask(0, 0, -1, -1); }
inline Mask left() { return Mask(-1, 0, -1, 0); }
inline Mask right() { return Mask(0, -1, 0, -1); }
inline Sample mono(float x) { return Sample(x); }
inline Sample stereo(float l, float r) { return Sample(l, r, l, r); }
inline float lane(Sample s, uint32_t i) { return s[static_cast<int>(i)]; }
inline float left(Sample s, uint32_t v) { return s[static_cast<int>(2 * v)]; }
inline float right(Sample s, uint32_t v) { return s[static_cast<int>(2 * v + 1)]; }
}  // namespace lanes

/// Non-owning view over Sample frames.
struct Block;
const Block& silentBlock();   // kMaxBlockSize frames of zeros, never written

/// Non-owning view over Sample frames. Empty (data == nullptr) means "unconnected": readOr() yields silence.
struct SignalView {
  Sample* data = nullptr;
  uint32_t numFrames = 0;
  bool empty() const { return data == nullptr; }
  const Sample* readOr() const;   // data, or the silent block when empty
  SignalView slice(uint32_t offset, uint32_t n) const { return empty() ? SignalView{nullptr, n} : SignalView{data + offset, n}; }
  void clear() const { for (uint32_t i = 0; i < numFrames; ++i) data[i] = Sample(0.f); }
};

/// Owns kMaxBlockSize frames, 16-byte aligned for SIMD loads. Allocated by the compiler on the message thread.
struct alignas(16) Block {
  std::array<Sample, kMaxBlockSize> data{};
  SignalView view(uint32_t frames) { return SignalView{data.data(), frames}; }
  void clear() { data.fill(Sample(0.f)); }
};

inline const Block& silentBlock() { static const Block zeros{}; return zeros; }
inline const Sample* SignalView::readOr() const { return data ? data : silentBlock().data.data(); }

}  // namespace pg

#pragma once
#include <algorithm>
#include <cassert>
#include <cstdint>
#include <functional>
#include <vector>

namespace pg {

/// Adapts arbitrary device period sizes to fixed engine blocks. RT-safe after prepare().
class BlockSplitter {
public:
  using BlockFn = std::function<void(float* interleavedOut, uint32_t frames)>;  // frames == blockSize

  void prepare(uint32_t blockSize, uint32_t channels) {
    assert(blockSize > 0 && channels > 0);
    blockSize_ = blockSize; channels_ = channels;
    carry_.assign(static_cast<size_t>(blockSize) * channels, 0.f);
    carryPos_ = 0; carryCount_ = 0;
  }

  void render(float* out, uint32_t frames, const BlockFn& block) {
    assert(!carry_.empty());
    uint32_t written = 0;
    while (written < frames) {
      if (carryCount_ == 0) { block(carry_.data(), blockSize_); carryPos_ = 0; carryCount_ = blockSize_; }
      const uint32_t n = std::min(frames - written, carryCount_);
      std::copy_n(carry_.data() + static_cast<size_t>(carryPos_) * channels_,
                  static_cast<size_t>(n) * channels_,
                  out + static_cast<size_t>(written) * channels_);
      written += n; carryPos_ += n; carryCount_ -= n;
    }
  }

  uint32_t blockSize() const { return blockSize_; }

private:
  uint32_t blockSize_ = 64, channels_ = 2, carryPos_ = 0, carryCount_ = 0;
  std::vector<float> carry_;
};

}  // namespace pg

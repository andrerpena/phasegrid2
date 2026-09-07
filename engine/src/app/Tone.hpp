#pragma once
#include <cmath>
#include <cstdint>
#include <numbers>

namespace pg {

struct ToneGenerator {
  double phase = 0.0, inc = 0.0;
  float amp = 0.25f;
  void prepare(double sampleRate, double hz) { inc = hz / sampleRate; phase = 0.0; }
  void render(float* out, uint32_t frames, uint32_t channels) {
    for (uint32_t f = 0; f < frames; ++f) {
      const float s = amp * static_cast<float>(std::sin(2.0 * std::numbers::pi * phase));
      phase += inc; if (phase >= 1.0) phase -= 1.0;
      for (uint32_t c = 0; c < channels; ++c) out[f * channels + c] = s;
    }
  }
};

}  // namespace pg

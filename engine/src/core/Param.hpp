#pragma once
#include <array>
#include <cmath>
#include "core/Conventions.hpp"
#include "core/Descriptor.hpp"

namespace pg {

float paramNormalize(const ParamDesc& d, float value);
float paramDenormalize(const ParamDesc& d, float norm);
Sample paramDenormalize(const ParamDesc& d, Sample norm);   // lane-wise; clamps each lane

class OnePoleSmoother {
public:
  void prepare(double sampleRate, float ms) {
    const double samples = sampleRate * ms / 1000.0;
    coeff_ = samples > 0 ? std::exp(-1.0 / samples) : 0.0;
  }
  void snap(float v) { value_ = target_ = v; }
  void setTarget(float t) { target_ = t; }
  bool isMoving() const { return std::fabs(value_ - target_) > 1e-6; }
  float next() {
    value_ = target_ + coeff_ * (value_ - target_);
    if (!isMoving()) value_ = target_;
    return static_cast<float>(value_);
  }
  float value() const { return static_cast<float>(value_); }
private:
  double value_ = 0.0, target_ = 0.0, coeff_ = 0.0;
};

/// Per-instance parameter state (knob + smoother). Survives program swaps.
struct ParamState {
  const ParamDesc* desc = nullptr;
  OnePoleSmoother smoother;
  float target = 0.f;                // normalized
  bool noSmooth = false;
  bool rampIsConstant = true;
  float constNorm = 0.f, constValue = 0.f;
  std::array<float, kMaxBlockSize> rampNorm{}, rampValue{};

  void prepare(const ParamDesc* d, double sampleRate, float initialNorm);
  void setTargetNorm(float norm);
  void fillRamp(uint32_t frames);    // audio thread, once per block
};

/// What a module reads. Exactly one of polyBuf / monoBuf / k is used, in that priority.
struct ParamView {
  const Sample* polyBuf = nullptr;   // per-sample lane-wise values (modulated)
  const float* monoBuf = nullptr;    // per-sample scalar values (smoothing)
  float k = 0.f;                     // constant
  Sample at(uint32_t i) const { return polyBuf ? polyBuf[i] : Sample(monoBuf ? monoBuf[i] : k); }
};

}  // namespace pg

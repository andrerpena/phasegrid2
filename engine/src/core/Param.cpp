#include "core/Param.hpp"
#include <algorithm>
#include "poly_utils.h"

namespace pg {

static float clamp01(float v) { return std::min(1.f, std::max(0.f, v)); }

float paramDenormalize(const ParamDesc& d, float norm) {
  const float n = clamp01(norm);
  float v;
  switch (d.curve) {
    case ParamCurve::Log:     v = d.min * std::pow(d.max / d.min, n); break;
    case ParamCurve::Exp:     v = d.min + (d.max - d.min) * n * n; break;
    case ParamCurve::Quartic: v = d.min + (d.max - d.min) * n * n * n * n; break;
    case ParamCurve::Linear:  v = d.min + (d.max - d.min) * n; break;
  }
  if (d.flags & (kParamInteger | kParamEnum)) v = std::round(v);
  return std::min(d.max, std::max(d.min, v));
}

Sample paramDenormalize(const ParamDesc& d, Sample norm) {
  const Sample n = vital::utils::clamp(norm, 0.f, 1.f);
  Sample v;
  switch (d.curve) {
    case ParamCurve::Log:     v = vital::futils::exp2(n * std::log2(d.max / d.min)) * d.min; break;
    case ParamCurve::Exp:     v = n * n * (d.max - d.min) + d.min; break;
    case ParamCurve::Quartic: { const Sample q = n * n; v = q * q * (d.max - d.min) + d.min; break; }
    case ParamCurve::Linear:  v = n * (d.max - d.min) + d.min; break;
  }
  if (d.flags & (kParamInteger | kParamEnum)) v = vital::utils::round(v);
  return vital::utils::clamp(v, d.min, d.max);
}

float paramNormalize(const ParamDesc& d, float value) {
  const float v = std::min(d.max, std::max(d.min, value));
  switch (d.curve) {
    case ParamCurve::Log:     return clamp01(std::log(v / d.min) / std::log(d.max / d.min));
    case ParamCurve::Exp:     return clamp01(std::sqrt((v - d.min) / (d.max - d.min)));
    case ParamCurve::Quartic: return clamp01(std::sqrt(std::sqrt((v - d.min) / (d.max - d.min))));
    case ParamCurve::Linear:  return clamp01((v - d.min) / (d.max - d.min));
  }
  return 0.f;
}

void ParamState::prepare(const ParamDesc* d, double sampleRate, float initialNorm) {
  desc = d;
  noSmooth = (d->flags & kParamNoSmooth) != 0;
  smoother.prepare(sampleRate, 5.f);
  target = clamp01(initialNorm);
  smoother.snap(target);
  rampIsConstant = true;
  constNorm = target;
  constValue = paramDenormalize(*d, target);
}

void ParamState::setTargetNorm(float norm) { target = clamp01(norm); smoother.setTarget(target); }

void ParamState::fillRamp(uint32_t frames) {
  if (noSmooth) smoother.snap(target);
  if (!smoother.isMoving()) {
    rampIsConstant = true;
    constNorm = smoother.value();
    constValue = paramDenormalize(*desc, constNorm);
    return;
  }
  rampIsConstant = false;
  for (uint32_t i = 0; i < frames; ++i) { rampNorm[i] = smoother.next(); rampValue[i] = paramDenormalize(*desc, rampNorm[i]); }
}

}  // namespace pg

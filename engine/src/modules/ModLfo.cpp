#include <algorithm>
#include <cmath>
#include "core/Module.hpp"

namespace pg::modules {
namespace {

/**
 * `mod.lfo`: a low-frequency oscillator built to feed knobs.
 *
 * Three decisions, each of which is about what happens at the far end of the cable:
 *
 * - The output is BIPOLAR, `-depth..depth` around zero. Modulation adds to a knob in normalized
 *   units, so a bipolar signal swings the knob either side of where it is set, and the knob stays
 *   the centre of the movement. A unipolar LFO would push every knob upward from its own value,
 *   and the first thing anyone did with it would be to subtract a half.
 * - The rate is in hertz and is a log knob across four decades, because a slow sweep and a fast
 *   wobble are both things people reach for, and neither should live in the last millimetre.
 * - The shape is a MORPH rather than a list: one knob runs sine, triangle, saw, square, crossfading
 *   between neighbours. A knob is modulatable, drawable on the face and reachable with no
 *   inspector, none of which is true of a drop-down.
 *
 * Every cycle starts at the bottom, as the oscillators' do (`osc/Oscillator.hpp`), except the
 * square, which starts high the way `osc.pulse` does, so a reset gives a rising edge whichever
 * shape is dialled. There is no band-limiting: at LFO rates there is nothing to alias, and the
 * knob smoother downstream takes the corners off anyway.
 */

/// The four corners the shape knob visits, in order, each -1..1 across a cycle.
float sineAt(double p) { return static_cast<float>(-std::cos(2.0 * M_PI * p)); }
float triangleAt(double p) { return static_cast<float>(p < 0.5 ? 4.0 * p - 1.0 : 3.0 - 4.0 * p); }
float sawAt(double p) { return static_cast<float>(2.0 * p - 1.0); }
float squareAt(double p) { return p < 0.5 ? 1.f : -1.f; }

/// The morphed wave: `shape` in thirds picks the pair of corners and how far between them.
float morphAt(double shape, double phase) {
  const double s = std::clamp(shape, 0.0, 1.0) * 3.0;
  const int segment = std::min(2, static_cast<int>(s));
  const float t = static_cast<float>(s - segment);
  float a, b;
  switch (segment) {
    case 0: a = sineAt(phase); b = triangleAt(phase); break;
    case 1: a = triangleAt(phase); b = sawAt(phase); break;
    default: a = sawAt(phase); b = squareAt(phase); break;
  }
  return a + (b - a) * t;
}

const PortDesc kIn[] = {
  {"reset", "Reset", PortKind::Continuous, 1, SignalRole::Gate, "A rising edge restarts the cycle from its start"},
};
const PortDesc kOut[] = {
  {"out", "Out", PortKind::Continuous, 1, SignalRole::Cv, "The wave, -depth to depth around zero"},
};

const ParamDesc kParams[] = {
  {"rate", "Rate", 0.01f, 100.f, 2.f, ParamUnit::Hz, ParamCurve::Log, kParamPrimary | kParamModulatable, nullptr, 0,
   "knob", nullptr, "Cycles per second"},
  {"shape", "Shape", 0.f, 1.f, 0.f, ParamUnit::None, ParamCurve::Linear, kParamPrimary | kParamModulatable, nullptr, 0,
   "knob", nullptr, "Morphs through sine, triangle, saw and square, a third of the turn each"},
  {"depth", "Depth", 0.f, 1.f, 1.f, ParamUnit::Ratio, ParamCurve::Linear, kParamPrimary | kParamModulatable, nullptr, 0,
   "knob", nullptr, "How far the output swings either side of zero"},
};

/// The face: Reset, the wave, then Rate, Shape and Depth in a row, and the output.
const char* const kFace[] = {
  "reset wave wave wave rate rate shape shape depth depth out",
  ".     wave wave wave rate rate shape shape depth depth .  ",
};

/// One phase per lane, so a rate modulated per voice keeps a cycle per voice.
struct Lane {
  double phase = 0.0;
  float lastGate = 0.f;
};
struct State {
  Lane lane[4];
};

class ModLfo final : public VoicedModule<State> {
  void process(ProcessContext& c) override {
    State& s = st(c);
    const Sample* reset = c.in(0).readOr();
    Sample* out = c.out(0).data;
    const ParamView rate = c.param(0);
    const ParamView shape = c.param(1);
    const ParamView depth = c.param(2);
    for (uint32_t i = 0; i < c.numFrames; ++i) {
      float lanesOut[4];
      for (uint32_t k = 0; k < 4; ++k) {
        Lane& l = s.lane[k];
        const float gate = lanes::lane(reset[i], k);
        if (gateHigh(gate) && !gateHigh(l.lastGate)) l.phase = 0.0;
        l.lastGate = gate;
        lanesOut[k] = lanes::lane(depth.at(i), k) * morphAt(lanes::lane(shape.at(i), k), l.phase);
        l.phase += static_cast<double>(lanes::lane(rate.at(i), k)) / c.sampleRate;
        if (l.phase >= 1.0) l.phase -= std::floor(l.phase);
      }
      out[i] = Sample(lanesOut[0], lanesOut[1], lanesOut[2], lanesOut[3]);
    }
  }

  bool preview(const ParamValues& values, float* out, uint32_t count) override {
    auto read = [&values](const char* id, double fallback) {
      const auto it = values.find(id);
      return it == values.end() ? fallback : static_cast<double>(it->second);
    };
    const double shape = read("shape", 0.0);
    const float depth = static_cast<float>(read("depth", 1.0));
    for (uint32_t i = 0; i < count; ++i)
      out[i] = depth * morphAt(shape, static_cast<double>(i) / static_cast<double>(count));
    return true;
  }
};

}  // namespace

// Explicit `extern` (see AudioOut.cpp): a namespace-scope `const` is internal linkage by default.
extern const ModuleDescriptor kModLfo{kModuleAbiVersion, "mod.lfo", "LFO", "Modulation",
  "A low-frequency oscillator for driving knobs. Rate is in hertz; Shape morphs sine, triangle, saw and "
  "square; Depth sets the swing. The output is bipolar, so the knob it feeds stays the centre of the "
  "movement. A rising edge on Reset restarts the cycle. The face shows the wave.",
  kIn, countOf(kIn), kOut, countOf(kOut), kParams, countOf(kParams), kModulePreviewsWave, 0,
  [] () -> Module* { return new ModLfo(); }, kFace, countOf(kFace)};

}  // namespace pg::modules

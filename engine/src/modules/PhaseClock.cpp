#include <cmath>
#include "core/Module.hpp"
#include "modules/Division.hpp"

namespace pg::modules {
namespace {

const PortDesc kOut[] = {
  {"phase", "Phase", PortKind::Continuous, 1, SignalRole::Phase, "Ramp from 0 to just under 1 over each cycle"},
  {"trigger", "Trigger", PortKind::Continuous, 1, SignalRole::Gate, "1 for a single frame at the start of every cycle"},
};
const ParamDesc kParams[] = {
  {"division", "Division", 0.f, static_cast<float>(kDivisionCount - 1), 2.f, ParamUnit::None,
   ParamCurve::Linear, kParamEnum | kParamInteger | kParamNoSmooth, kDivisionLabels, kDivisionCount,
   "select", nullptr, "How long one cycle lasts, in musical time"},
  {"swing", "Swing", 0.f, 0.5f, 0.f, ParamUnit::Ratio, ParamCurve::Linear, kParamPrimary | kParamModulatable, nullptr, 0,
   "slider", nullptr, "Delays the start of every second cycle by this fraction of a cycle"},
};

/// The largest float below 1. The phase output is documented as `0 <= phase < 1`, and a double just under 1
/// rounds UP to exactly 1 when narrowed, so the cast has to be caught rather than trusted.
constexpr float kJustBelowOne = 0x1.fffffep-1f;

/// Splits a position measured in cycles into the swung phase of the current cycle, plus which cycle it is.
/// Swing moves the boundary inside each PAIR of cycles: the second one starts at `1 + swing` instead of 1,
/// and both are then stretched back over a full 0..1 ramp, so a downstream envelope still sees a whole
/// cycle. With swing 0 this is exactly `frac(position)`.
struct Swung {
  float phase;
  int64_t cycle;
};
Swung swing(double position, float amount) {
  const double pair = std::floor(position * 0.5);
  const double u = position - pair * 2.0;               // 0 <= u < 2: where we are inside the pair
  const double split = 1.0 + amount;
  double local;
  int64_t cycle = static_cast<int64_t>(pair) * 2;
  if (u < split) {
    local = u / split;
  } else {
    local = (u - split) / (2.0 - split);
    cycle += 1;
  }
  float phase = static_cast<float>(local);
  if (phase >= 1.f) phase = kJustBelowOne;
  if (phase < 0.f) phase = 0.f;
  return Swung{phase, cycle};
}

struct State {
  int64_t lastCycle = -1;   // no cycle seen yet, so the very first frame starts one and fires
};

class PhaseClock final : public VoicedModule<State> {
  void process(ProcessContext& c) override {
    State& s = st(c);
    const TransportSnapshot& t = *c.transport;
    Sample* phaseOut = c.out(0).data;
    Sample* triggerOut = c.out(1).data;

    const double quarters =
      quartersPerCycle(static_cast<uint32_t>(lanes::lane(c.param(0).at(0), 0)), t);
    const double samplesPerQuarter = 60.0 * c.sampleRate / (t.tempo > 0.0 ? t.tempo : 120.0);
    // Stopped, the clock free-runs off the sample position at the transport's tempo, so a patch still moves
    // while nothing is playing. Running, it follows the host's musical position exactly.
    const double startQuarters = t.playing ? t.ppq : static_cast<double>(t.samplePos) / samplesPerQuarter;

    const ParamView swingParam = c.param(1);
    for (uint32_t i = 0; i < c.numFrames; ++i) {
      const double position = (startQuarters + i / samplesPerQuarter) / quarters;
      // The clock is one global ramp, not a per-voice one, so it reads lane 0 of the swing modulation and
      // writes the same value to every lane.
      const Swung now = swing(position, lanes::lane(swingParam.at(i), 0));
      phaseOut[i] = Sample(now.phase);
      triggerOut[i] = Sample(now.cycle != s.lastCycle ? 1.f : 0.f);
      s.lastCycle = now.cycle;
    }
  }
};

}  // namespace

// Explicit `extern` (see AudioOut.cpp): a namespace-scope `const` is internal linkage by default.
extern const ModuleDescriptor kPhaseClock{kModuleAbiVersion, "phase.clock", "Clock", "time",
  "A phase ramp locked to the transport, plus a one-frame trigger at the start of each cycle. Drives "
  "sequencers and ramp-fed oscillators. While the transport is stopped it free-runs at its tempo.",
  nullptr, 0, kOut, countOf(kOut), kParams, countOf(kParams), kModuleNeedsTransport, 0,
  [] () -> Module* { return new PhaseClock(); }, nullptr, 0};

}  // namespace pg::modules

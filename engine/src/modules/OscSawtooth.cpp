#include <algorithm>
#include <cmath>
#include "core/Module.hpp"

namespace pg::modules {
namespace {

/**
 * `osc.sawtooth`: the basic sawtooth, with hard sync.
 *
 * One control, Sync, in semitones. At 0 st the output is a plain rising ramp at the pitch on the input.
 * Above it a second ramp runs `2^(sync/12)` times faster and is thrown back to zero every time the
 * master cycle restarts, so the wave keeps the master's pitch and gains the slave's harmonics: the
 * classic sync sweep, and the same shape the face draws.
 *
 * Every discontinuity, whether the slave wrapping on its own or the master resetting it, is a step, and
 * every step gets a PolyBLEP: a polynomial correction that spends the step across the four samples
 * around it, the integral of a cubic B-spline minus the ideal step. Without it a saw at 2 kHz sprays
 * aliases twelve decibels down; with it they sit near forty. The correction reaches two samples back
 * and one forward, so the output runs two samples late.
 *
 * The four lanes run as four independent oscillators, the way the vendored ones do, so a stereo pitch
 * input gives a stereo result and a mono one costs nothing extra.
 */

const PortDesc kIn[] = {
  {"reset", "Reset", PortKind::Continuous, 1, SignalRole::Gate, "A rising edge restarts the cycle from phase 0"},
  {"phase", "Phase", PortKind::Continuous, 1, SignalRole::Phase,
   "When connected, drives the cycle in place of the internal ramp: 0 to just under 1, wrapping"},
  {"pitch", "Pitch", PortKind::Continuous, 1, SignalRole::Pitch, "Pitch to play, 0.1 per octave from middle C"},
};
const PortDesc kOut[] = {
  {"out", "Out", PortKind::Continuous, 1, SignalRole::Audio, "The sawtooth, -1 to 1"},
};
const ParamDesc kParams[] = {
  {"sync", "Sync", 0.f, 48.f, 0.f, ParamUnit::Semitones, ParamCurve::Linear, kParamPrimary | kParamModulatable,
   nullptr, 0, "knob", nullptr,
   "How far above the pitch the synced ramp runs, in semitones. At 0 the output is a plain sawtooth"},
};

constexpr uint32_t kLanes = 4;

/// The ideal wave, before any band-limiting: what the picture shows and what the sound approximates.
float ideal(double slavePhase) { return static_cast<float>(2.0 * slavePhase - 1.0); }

struct Lane {
  double master = 0.0;     // 0..1, the ramp everything hangs off
  double lastPhaseIn = 0.0;
  float lastGate = 0.f;
  float pending[2] = {-1.f, -1.f};   // the last two frames' outputs, held back so a step can reach them
  float carry = 0.f;                 // correction already owed to the next frame's output
};

/**
 * What a unit step leaves behind once it has been smoothed by a cubic B-spline: the spline's integral
 * minus the step itself, at `x` samples from the step. Zero outside two samples either side.
 */
double residual(double x) {
  if (x <= -2.0 || x >= 2.0) return 0.0;
  if (x < -1.0) { const double u = 2.0 + x; return u * u * u * u / 24.0; }
  if (x < 0.0) return 0.5 + x * (2.0 / 3.0) - x * x * x / 3.0 - x * x * x * x / 8.0;
  if (x < 1.0) return -0.5 + x * (2.0 / 3.0) - x * x * x / 3.0 + x * x * x * x / 8.0;
  const double u = 2.0 - x;
  return -u * u * u * u / 24.0;
}

struct State {
  Lane lane[kLanes];
};

/// Where the slave is for a master phase: it runs `ratio` times faster and wraps on its own.
double slaveOf(double master, double ratio) {
  const double s = master * ratio;
  return s - std::floor(s);
}

class OscSawtooth final : public VoicedModule<State> {
  /**
   * A downward step of `size` that happened `since` samples ago (0 <= since < 1). The two samples before
   * it are pulled down and the current one and the next are pushed up, each by the residual at its own
   * distance from the step. Summed over the four, the step lands where it should with its top
   * harmonics rolled off.
   */
  static void blep(Lane& l, float& current, double size, double since) {
    l.pending[0] -= static_cast<float>(size * residual(since - 2.0));
    l.pending[1] -= static_cast<float>(size * residual(since - 1.0));
    current -= static_cast<float>(size * residual(since));
    l.carry -= static_cast<float>(size * residual(since + 1.0));
  }

  /// Every time the slave wrapped while the master ran from `from` to `to` (both unwrapped, in slave
  /// cycles): one step of the full height each, timed by where the crossing fell inside the frame.
  /// `atEnd` is how many samples before the current one the position `to` was reached.
  static void slaveWraps(Lane& l, float& current, double from, double to, double perSample, double atEnd) {
    if (perSample <= 0.0) return;
    int guard = 0;
    for (double m = std::floor(from) + 1.0; m <= to && guard < 32; m += 1.0, ++guard) {
      const double since = atEnd + (to - m) / perSample;
      if (since < 1.0) blep(l, current, 2.0, since);
    }
  }

  void process(ProcessContext& c) override {
    State& s = st(c);
    const Sample* reset = c.in(0).readOr();
    const bool phaseConnected = !c.in(1).empty();
    const Sample* phaseIn = c.in(1).readOr();
    const Sample* pitch = c.in(2).readOr();
    const ParamView sync = c.param(0);
    Sample* out = c.out(0).data;
    const double sampleRate = c.sampleRate;

    for (uint32_t i = 0; i < c.numFrames; ++i) {
      float lanesOut[kLanes];
      const Sample syncNow = sync.at(i);
      for (uint32_t k = 0; k < kLanes; ++k) {
        Lane& l = s.lane[k];
        const double ratio = std::exp2(static_cast<double>(lanes::lane(syncNow, k)) / 12.0);
        const double before = l.master;
        double inc;                 // how far the master moved this frame, in cycles
        double resetSince = -1.0;   // samples ago the master restarted, or negative for not at all

        if (phaseConnected) {
          const double p = std::clamp(static_cast<double>(lanes::lane(phaseIn[i], k)), 0.0, 0.999999);
          const bool wrapped = p < l.lastPhaseIn;
          inc = std::max(0.0, p - l.lastPhaseIn + (wrapped ? 1.0 : 0.0));
          if (wrapped && inc > 0.0) resetSince = std::min(p / inc, 0.999999);
          l.lastPhaseIn = p;
          l.master = p;
        } else {
          inc = std::clamp(pitchToHz(lanes::lane(pitch[i], k)) / sampleRate, 0.0, 0.5);
          l.master += inc;
          if (l.master >= 1.0) {
            l.master -= std::floor(l.master);
            resetSince = inc > 0.0 ? std::min(l.master / inc, 0.999999) : 0.0;
          }
        }

        // A rising edge on Reset restarts the cycle at this very sample, whatever the ramp was doing.
        const float gate = lanes::lane(reset[i], k);
        if (gateHigh(gate) && !gateHigh(l.lastGate)) {
          l.master = 0.0;
          resetSince = 0.0;
        }
        l.lastGate = gate;

        float current = l.carry;   // whatever the last step already owed this sample
        l.carry = 0.f;
        const double perSample = inc * ratio;   // slave cycles per sample
        if (resetSince >= 0.0) {
          // Up to the restart the master ran from `before` towards 1 (or wherever it was cut off by a
          // Reset); the slave may have wrapped on the way, then the restart throws it to zero.
          const double reached = resetSince == 0.0 && inc == 0.0 ? before : (before + inc * (1.0 - resetSince));
          const double top = std::min(reached, 1.0);
          slaveWraps(l, current, before * ratio, top * ratio, perSample, resetSince);
          blep(l, current, 2.0 * slaveOf(top, ratio), resetSince);
          slaveWraps(l, current, 0.0, l.master * ratio, perSample, 0.0);
        } else {
          slaveWraps(l, current, before * ratio, l.master * ratio, perSample, 0.0);
        }
        current += ideal(slaveOf(l.master, ratio));

        lanesOut[k] = l.pending[0];
        l.pending[0] = l.pending[1];
        l.pending[1] = current;
      }
      out[i] = Sample(lanesOut[0], lanesOut[1], lanesOut[2], lanesOut[3]);
    }
  }

  bool preview(const ParamValues& values, float* out, uint32_t count) override {
    const auto it = values.find("sync");
    const double ratio = std::exp2((it == values.end() ? 0.0 : static_cast<double>(it->second)) / 12.0);
    for (uint32_t i = 0; i < count; ++i) {
      const double master = static_cast<double>(i) / static_cast<double>(count);
      const double slave = master * ratio;
      out[i] = ideal(slave - std::floor(slave));
    }
    return true;
  }
};

}  // namespace

// Explicit `extern` (see AudioOut.cpp): a namespace-scope `const` is internal linkage by default.
extern const ModuleDescriptor kOscSawtooth{kModuleAbiVersion, "osc.sawtooth", "Sawtooth", "osc",
  "A band-limited sawtooth with hard sync. Sync, in semitones, runs a second ramp faster than the pitch and "
  "restarts it every cycle, which keeps the pitch and adds the classic sync harmonics. The face shows the "
  "resulting shape.",
  kIn, countOf(kIn), kOut, countOf(kOut), kParams, countOf(kParams), kModulePreviewsWave, 0,
  [] () -> Module* { return new OscSawtooth(); }};

}  // namespace pg::modules

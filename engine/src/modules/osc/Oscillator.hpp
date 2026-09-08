#pragma once
#include <algorithm>
#include <cmath>
#include "core/Module.hpp"

/**
 * The part of an oscillator that is the same whatever wave it plays.
 *
 * Pitch to frequency, the master phase, an external phase in place of it, the reset gate, hard sync,
 * band-limiting every discontinuity, the four lanes, and the picture the module's face draws. All of
 * that is here once. What is left to a module is the wave itself, which is a value at a phase and a
 * list of the places it steps -- a dozen lines rather than two hundred.
 *
 * That split is the point. A sawtooth and a pulse differ by three numbers, and the waves worth having
 * later -- one someone draws, one written as an expression, one rendered into a table -- differ from
 * both only in where `at()` gets its answer. None of them is a different oscillator.
 */
namespace pg::modules::osc {

/// A step in a wave: at `phase` the value jumps by `delta`, the value just after minus just before.
/// A sawtooth has one, at phase 0, of -2. A square has two: +2 at 0 and -2 at its width.
struct ShapeJump {
  double phase;
  double delta;
};

/**
 * A shape is any type with these three, and nothing else is asked of it:
 *
 *   float at(double phase) const;        // -1..1 across one cycle
 *   uint32_t jumpCount() const;
 *   ShapeJump jump(uint32_t index) const;
 *
 * It may also offer `float at(double from, double to) const`, the wave's average across the phase
 * interval one output sample covers rather than its value at a point. A shape that is bent rather than
 * broken -- a folded sine has corners and no steps -- has nothing for the step correction below to fix,
 * and this is how it band-limits itself instead. `valueAt` picks whichever the shape has.
 *
 * A formula declares its steps so they can be band-limited exactly, which is what the correction below
 * does. A shape read from a wavetable declares none: a table is band-limited when it is built, per
 * octave, because nothing can know analytically where an arbitrary drawn wave steps. Sync is the one
 * discontinuity neither kind can declare, since it is the oscillator that throws the wave back to zero
 * mid-cycle, so the core works it out for itself as `at(0) - at(phase it was at)`. That expression is
 * as true of a table as of a formula, which is what lets one core serve both.
 */

/// One lane's running state. Four lanes to a voice pair, each an independent oscillator.
struct Lane {
  double master = 0.0;     // 0..1, the cycle everything hangs off
  double lastPhaseIn = 0.0;
  float lastGate = 0.f;
  double lastSlave = 0.0;          // where the wave was on the previous sample, for a shape that averages
  bool seeded = false;             // the held-back outputs still need the wave's starting value
  float pending[2] = {0.f, 0.f};   // the last two outputs, held back so a step can still reach them
  float carry = 0.f;               // correction a step has already promised the next output
};

inline constexpr uint32_t kLanes = 4;

/// Per voice pair. A module holds one of these and hands it to `render`.
struct OscillatorState {
  Lane lane[kLanes];
};

/**
 * What a unit step leaves behind once it has been smoothed by a cubic B-spline: the spline's integral
 * minus the step itself, at `x` samples from the step. Zero beyond two samples either side.
 *
 * This is the whole of the anti-aliasing. A step dropped straight into a sampled signal has harmonics
 * all the way up, which fold back and sound like a ring of wrong notes; spreading it over four samples
 * this way puts the aliases some forty decibels down instead of twelve.
 */
inline double residual(double x) {
  if (x <= -2.0 || x >= 2.0) return 0.0;
  if (x < -1.0) { const double u = 2.0 + x; return u * u * u * u / 24.0; }
  if (x < 0.0) return 0.5 + x * (2.0 / 3.0) - x * x * x / 3.0 - x * x * x * x / 8.0;
  if (x < 1.0) return -0.5 + x * (2.0 / 3.0) - x * x * x / 3.0 + x * x * x * x / 8.0;
  const double u = 2.0 - x;
  return -u * u * u * u / 24.0;
}

/// Spreads a step of `delta` that happened `since` samples ago (0 <= since < 1) over the four outputs
/// around it: the two already held back, this one, and the one still to come.
inline void applyStep(Lane& l, float& current, double delta, double since) {
  l.pending[0] += static_cast<float>(delta * residual(since - 2.0));
  l.pending[1] += static_cast<float>(delta * residual(since - 1.0));
  current += static_cast<float>(delta * residual(since));
  l.carry += static_cast<float>(delta * residual(since + 1.0));
}

/// The wave's value for the sample spanning `from` to `to`: its average across the interval when the
/// shape can say, and its value at the end of the interval when it cannot.
template <class Shape>
float valueAt(const Shape& shape, double from, double to) {
  if constexpr (requires(const Shape& s) { s.at(from, to); }) return shape.at(from, to);
  else return shape.at(to);
}

/// The slave's position for a master phase: it runs `ratio` times faster and wraps on its own.
inline double slaveOf(double master, double ratio) {
  const double s = master * ratio;
  return s - std::floor(s);
}

/// Every one of the shape's own steps crossed while the slave ran from `from` to `to` (unwrapped, in
/// cycles), each timed by where inside the frame it fell. `atEnd` is how far before the current sample
/// the position `to` was reached.
template <class Shape>
void crossings(const Shape& shape, Lane& l, float& current, double from, double to, double perSample,
               double atEnd) {
  if (perSample <= 0.0) return;
  const uint32_t count = shape.jumpCount();
  for (uint32_t j = 0; j < count; ++j) {
    const ShapeJump step = shape.jump(j);
    // Every cycle the slave passed through, at this step's position within it.
    int guard = 0;
    for (double m = std::floor(from - step.phase) + 1.0 + step.phase; m <= to && guard < 64; m += 1.0, ++guard) {
      const double since = atEnd + (to - m) / perSample;
      if (since >= 0.0 && since < 1.0) applyStep(l, current, step.delta, since);
    }
  }
}

/**
 * Renders a block.
 *
 * `makeShape(frame, lane)` returns the shape for that sample, built from whatever parameters the module
 * has. It is taken by value and is expected to be a handful of numbers, so there is nothing to allocate
 * and nothing virtual on the audio thread.
 *
 * Ports are the three every oscillator declares, in the order `kOscInputs` gives them: reset, phase,
 * pitch. The sync ratio comes from the shape's owner through `syncSemitones`, read per sample so it can
 * be modulated.
 */
template <class MakeShape, class SyncAt>
void render(ProcessContext& c, OscillatorState& state, MakeShape&& makeShape, SyncAt&& syncSemitones) {
  const Sample* reset = c.in(0).readOr();
  const bool phaseConnected = !c.in(1).empty();
  const Sample* phaseIn = c.in(1).readOr();
  const Sample* pitch = c.in(2).readOr();
  Sample* out = c.out(0).data;
  const double sampleRate = c.sampleRate;

  for (uint32_t i = 0; i < c.numFrames; ++i) {
    float lanesOut[kLanes];
    for (uint32_t k = 0; k < kLanes; ++k) {
      Lane& l = state.lane[k];
      const auto shape = makeShape(i, k);
      // The first two outputs are the ones the delay has nothing real to hold yet. Seeding them with
      // the wave at its start is what the sawtooth did with a literal -1; asking the shape is the same
      // thing said generically, and it keeps a square from opening on a click up from zero.
      if (!l.seeded) {
        l.pending[0] = l.pending[1] = shape.at(0.0);
        l.seeded = true;
      }
      const double ratio = std::exp2(syncSemitones(i, k) / 12.0);
      const double before = l.master;
      double inc = 0.0;           // how far the master moved this sample, in cycles
      double resetSince = -1.0;   // samples ago the master restarted, negative for not at all

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
        // Up to the restart the master ran towards 1, or to wherever a Reset cut it off; the shape's own
        // steps may have gone by on the way, and then the restart throws the wave back to phase zero.
        const double reached = resetSince == 0.0 && inc == 0.0 ? before : before + inc * (1.0 - resetSince);
        const double top = std::min(reached, 1.0);
        crossings(shape, l, current, before * ratio, top * ratio, perSample, resetSince);
        // The sync step itself: from wherever the wave had got to, back to its start.
        const double landed = slaveOf(top, ratio);
        applyStep(l, current, static_cast<double>(shape.at(0.0)) - shape.at(landed), resetSince);
        crossings(shape, l, current, 0.0, l.master * ratio, perSample, 0.0);
      } else {
        crossings(shape, l, current, before * ratio, l.master * ratio, perSample, 0.0);
      }
      const double slave = slaveOf(l.master, ratio);
      current += valueAt(shape, l.lastSlave, slave);
      l.lastSlave = slave;

      // The correction reaches two samples back, so the output runs two samples behind the wave.
      lanesOut[k] = l.pending[0];
      l.pending[0] = l.pending[1];
      l.pending[1] = current;
    }
    out[i] = Sample(lanesOut[0], lanesOut[1], lanesOut[2], lanesOut[3]);
  }
}

/// One master cycle of a shape at a sync ratio: the ideal wave, before any band-limiting, which is
/// exactly what belongs on a module's face.
template <class Shape>
void preview(const Shape& shape, double ratio, float* out, uint32_t count) {
  for (uint32_t i = 0; i < count; ++i)
    out[i] = shape.at(slaveOf(static_cast<double>(i) / static_cast<double>(count), ratio));
}

// ---- what every oscillator declares, so they cannot drift apart -------------------------------------

inline constexpr PortDesc kOscInputs[] = {
  {"reset", "Reset", PortKind::Continuous, 1, SignalRole::Gate, "A rising edge restarts the cycle from phase 0"},
  {"phase", "Phase", PortKind::Continuous, 1, SignalRole::Phase,
   "When connected, drives the cycle in place of the internal ramp: 0 to just under 1, wrapping"},
  {"pitch", "Pitch", PortKind::Continuous, 1, SignalRole::Pitch, "Pitch to play, 0.1 per octave from middle C"},
};
inline constexpr PortDesc kOscOutputs[] = {
  {"out", "Out", PortKind::Continuous, 1, SignalRole::Audio, "The wave, -1 to 1"},
};
inline constexpr ParamDesc kSyncParam{
  "sync", "Sync", 0.f, 48.f, 0.f, ParamUnit::Semitones, ParamCurve::Linear,
  kParamPrimary | kParamModulatable, nullptr, 0, "knob", nullptr,
  "How far above the pitch the synced wave runs, in semitones. At 0 the output is the plain shape"};

}  // namespace pg::modules::osc

#include "modules/osc/Oscillator.hpp"

namespace pg::modules {
namespace {

/**
 * `osc.sine`: a sine, with a wavefolder.
 *
 * At Fold 0 it is a plain sine and the only thing in its spectrum is the fundamental. Turning Fold up
 * amplifies the wave about its middle and reflects whatever runs past full scale back inside, which is
 * what a folder does: the single arch on the face grows a dip, then another, then becomes a zigzag,
 * and the sound gains harmonics without any filter being involved.
 *
 * Amplified about the middle rather than driven up from the bottom. The difference is visible: this
 * way the whole wave slides as the knob turns, so where the cycle begins travels between the bottom of
 * the panel and the top and back, which is what the reference instrument does. It is audible too --
 * the wave keeps the antisymmetry across its half cycle that a sine has, so folding adds odd harmonics
 * and never an even one, and the tone brightens without ever jumping an octave.
 *
 * The cycle starts at the bottom rather than at zero -- `-cos` rather than `sin` -- so that a reset
 * begins with a rising edge, the way the sawtooth begins at -1 and the pulse begins high. That makes
 * the three oscillators agree about what phase 0 means, which matters as soon as one drives another's
 * `phase` input.
 *
 * The shape declares no steps, and that is not an oversight: folding bends a wave, it never breaks it.
 * A corner radiates far less than a step does -- harmonics falling as 1/n^2 rather than 1/n -- and the
 * measurement is in `test_osc_sine.cpp` rather than assumed.
 */
struct SineShape {
  /// 1 is unfolded. Above that the wave is amplified before being reflected back into range.
  double gain = 1.0;

  float at(double phase) const { return foldBack(driven(phase)); }

  /**
   * The wave averaged across the phase interval one output sample covers, rather than read at a point.
   *
   * Folding turns a clean sine into a wave full of corners, and a corner sampled at a point radiates
   * harmonics that fold back down the spectrum: measured, a fully folded sine at 2 kHz put its aliases
   * only 22 dB below the harmonics, against the 30 dB the sawtooth and pulse hold.
   *
   * The average is what fixes it, and it is exact rather than approximated: the mean of a function over
   * an interval is the difference of its antiderivative across the ends, divided by the width. The
   * folding curve is a triangle, whose antiderivative is a run of parabolas, so this costs two
   * polynomials and a divide -- no oversampling, and nothing that has to know where the corners are.
   *
   * That last part is why it is worth doing this way. Any wave that is a signal driven through a
   * shaping curve can be band-limited like this, including one somebody writes for themselves later.
   */
  float at(double from, double to) const {
    const double u0 = driven(from);
    const double u1 = driven(to);
    const double du = u1 - u0;
    // A near-motionless step: the difference below would be zero over zero. The midpoint is both the
    // limit of the average and the right answer for a wave that is barely moving.
    if (std::fabs(du) < 1e-9) return foldBack(0.5 * (u0 + u1));
    return static_cast<float>((foldIntegral(u1) - foldIntegral(u0)) / du);
  }

  uint32_t jumpCount() const { return 0; }
  osc::ShapeJump jump(uint32_t) const { return {0.0, 0.0}; }

  /// The sine before it is folded: a cosine starting at the bottom, amplified about zero by the fold
  /// amount. At gain 1 this is the plain sine, which is why Fold 0 costs nothing.
  double driven(double phase) const { return gain * -std::cos(2.0 * M_PI * phase); }

  /**
   * Reflects a value back into -1..1, as many times as it takes.
   *
   * A triangle of period 4 through (0,0), (1,1), (2,0), (3,-1): past full scale the wave turns around
   * and comes back, and past the other end it turns again. Written as a fractional part rather than a
   * loop so the cost does not grow with how hard the wave is being driven.
   */
  static float foldBack(double v) {
    const double q = wrap(v);
    return static_cast<float>(1.0 - 4.0 * std::fabs(q - 0.5));
  }

  /// An antiderivative of `foldBack`. Periodic, because one period of a triangle integrates to nothing.
  static double foldIntegral(double v) {
    const double q = wrap(v);
    return 4.0 * (q <= 0.5 ? 2.0 * q * q - q : 3.0 * q - 2.0 * q * q - 1.0);
  }

  /// Where `v` falls inside the folding curve's period of four, as 0..1.
  static double wrap(double v) {
    const double w = v * 0.25 + 0.25;
    return w - std::floor(w);
  }
};

/**
 * Fold is measured in semitones, the same unit and the same 0..48 range as the other oscillators' Sync.
 *
 * Not decoration: an octave of fold is a doubling of how hard the wave is driven, exactly as an octave
 * of sync is a doubling of how fast it runs. Twelve semitones puts two lobes on the face, twenty-four
 * puts four, and forty-eight drives the wave sixteen times over and fills the panel with them. A linear
 * knob would spend most of its travel in the last few.
 */
const ParamDesc kParams[] = {
  {"fold", "Fold", 0.f, 48.f, 0.f, ParamUnit::Semitones, ParamCurve::Linear,
   kParamPrimary | kParamModulatable, nullptr, 0, "knob", nullptr,
   "How hard the wave is driven past full scale before being reflected back, in semitones: every twelve "
   "doubles it, and each doubling folds another pair of lobes into the cycle"},
};

double gainFor(double semitones) { return std::exp2(std::clamp(semitones, 0.0, 48.0) / 12.0); }

class OscSine final : public VoicedModule<osc::OscillatorState> {
  void process(ProcessContext& c) override {
    const ParamView fold = c.param(0);
    osc::render(
      c, st(c),
      [&fold](uint32_t i, uint32_t lane) {
        return SineShape{gainFor(static_cast<double>(lanes::lane(fold.at(i), lane)))};
      },
      // No Sync on this one: a folder is what shapes it. The core still handles a `reset` and an
      // outside `phase` exactly as it does for the others.
      [](uint32_t, uint32_t) { return 0.0; });
  }

  bool preview(const ParamValues& values, float* out, uint32_t count) override {
    const auto it = values.find("fold");
    const double fold = it == values.end() ? 0.0 : static_cast<double>(it->second);
    osc::preview(SineShape{gainFor(fold)}, 1.0, out, count);
    return true;
  }
};

}  // namespace

// Explicit `extern` (see AudioOut.cpp): a namespace-scope `const` is internal linkage by default.
extern const ModuleDescriptor kOscSine{kModuleAbiVersion, "osc.sine", "Sine", "osc",
  "A sine with a wavefolder. At Fold 0 it is the one wave with no harmonics at all; turning Fold up drives it "
  "past full scale and reflects it back on itself, filling the spectrum with odd harmonics. Fold is in "
  "semitones, so every twelve doubles the drive. The face shows the resulting shape.",
  osc::kOscInputs, countOf(osc::kOscInputs), osc::kOscOutputs, countOf(osc::kOscOutputs),
  kParams, countOf(kParams), kModulePreviewsWave, 0,
  [] () -> Module* { return new OscSine(); }};

}  // namespace pg::modules

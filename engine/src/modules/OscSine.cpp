#include "modules/osc/Oscillator.hpp"

namespace pg::modules {
namespace {

/**
 * `osc.sine`: a sine, with a wavefolder.
 *
 * The wave is fed through `sin` itself: `sin(drive * sine)`. That is the whole folder, and the choice
 * of curve is what you see. A triangle curve turns the wave around at a hard corner every time it runs
 * past full scale, and every lobe on the face comes out pointed; `sin` has no corners anywhere, so the
 * lobes come out as round as the wave that made them, and at twelve semitones the two of them meet at
 * the centre line like two sines merging, which is the reference instrument's picture exactly.
 *
 * At Fold 0 the curve is not applied at all and the wave is the sine itself. That was once otherwise:
 * the drive started at pi/2 so that every octave of the knob would double it, which cost a third
 * harmonic eighteen decibels down at rest. Eighteen decibels down is twelve percent distortion, audible
 * on the plainest note anyone can play, and it made the instrument's most basic waveform not a sine. A
 * knob calibration is not worth that. The drive now starts from nothing and the doubling is measured
 * from there, which keeps the one milestone that matters -- twelve semitones is still exactly a drive of
 * pi, two lobes meeting at the centre line -- and gives up only the arithmetic above it.
 *
 * Below a quarter turn the curve cannot reach full scale on its own, so the wave is divided by the peak
 * the curve actually reaches. Without that, turning Fold down would fade the oscillator out instead of
 * unfolding it.
 *
 * The wave keeps the antisymmetry across its half cycle that a sine has, so folding adds odd harmonics
 * and never an even one, and the tone brightens without ever jumping an octave.
 *
 * The cycle starts at the rising zero crossing -- `sin`, the plain thing the name promises. It cost the
 * agreement the other two oscillators keep, that phase 0 is the bottom of the wave, and it was worth it:
 * a sawtooth and a pulse genuinely begin at a corner, so a note of theirs opens with a step whatever we
 * choose, but a sine does not have to. Starting at zero is the difference between a note that begins
 * silently and one that begins with a full-scale click, and with no envelope in the patch there is
 * nothing else to hide it. The reference instrument's sine starts here too. A reset still begins with a
 * rising edge; what follows it is a wave leaving zero rather than leaving the floor.
 *
 * The shape declares no steps, and needs no other correction either: this folder never breaks the
 * wave and, with `sin` for a curve, never even bends it sharply, so the curve band-limits itself. That
 * was measured rather than assumed. Averaging each sample across its phase interval -- exact for this
 * curve, and worth ten decibels when the curve was a triangle -- was tried here too and bought three to
 * five decibels in the one corner that is past saving anyway, and nothing where the instrument is
 * played, so it went. The numbers are in `test_osc_sine.cpp`.
 */
/// Below this the curve is the identity to the last bit of a float, and the peak it reaches is too
/// small to divide by.
constexpr double kUnfolded = 1e-4;

struct SineShape {
  /// How far the wave is driven into the folding curve: the argument `sin` sees at the wave's peak.
  /// Zero is no folding at all; pi puts two lobes in each half of the cycle.
  double drive = 0.0;

  float at(double phase) const {
    const double u = unit(phase);
    // Not an optimisation: at Fold 0 the wave must be the sine exactly, and the scaling below divides
    // by a peak that has gone to zero with the drive.
    if (drive < kUnfolded) return static_cast<float>(u);
    // The largest value the curve reaches over the wave's own range. Past a quarter turn that is 1 and
    // the division does nothing; below it the curve is still climbing, and the wave would come out
    // quieter and quieter as Fold went down.
    const double peak = drive < M_PI / 2.0 ? std::sin(drive) : 1.0;
    return static_cast<float>(std::sin(drive * u) / peak);
  }

  uint32_t jumpCount() const { return 0; }
  osc::ShapeJump jump(uint32_t) const { return {0.0, 0.0}; }

  /// The sine before it is folded: -1..1, leaving zero upwards at phase 0.
  static double unit(double phase) { return std::sin(2.0 * M_PI * phase); }
};

/**
 * Fold is measured in semitones, the same unit as the other oscillators' Sync.
 *
 * Not decoration: an octave of fold doubles the *span* the wave is driven across, exactly as an octave
 * of sync doubles how fast it runs, and the span is measured from no drive at all. At 0 st there is no
 * folding and the wave is a sine; twelve semitones is a drive of pi, where two round lobes meet at the
 * centre line; every further octave doubles the distance travelled from zero. A linear knob would spend
 * most of its travel in the last few semitones.
 *
 * Three octaves, not Sync's four. Folding raises the wave's fastest moment to roughly the pitch times
 * the drive, and that has to stay under half the sample rate or the extra lobes come back as a ring of
 * wrong notes. At three octaves the drive is 7pi and A4 folds up to about 10 kHz, which is safe with
 * room to spare; a fourth octave doubles it again and, measured, the off-harmonic energy falls off a
 * cliff from 85 dB down to 42. The knob stops where the wave is still a wave.
 */
const ParamDesc kParams[] = {
  {"fold", "Fold", 0.f, 36.f, 0.f, ParamUnit::Semitones, ParamCurve::Linear,
   kParamPrimary | kParamModulatable, nullptr, 0, "knob", nullptr,
   "How hard the wave is driven past full scale before being reflected back, in semitones: every twelve "
   "doubles it, and each doubling folds another pair of lobes into the cycle"},
};

double driveFor(double semitones) { return M_PI * (std::exp2(std::clamp(semitones, 0.0, 36.0) / 12.0) - 1.0); }

/// The face: the three inputs down the left, the wave beside them, fold on its right, the output last.
const char* const kFace[] = {
  "reset wave wave wave fold fold out",
  "phase wave wave wave fold fold .  ",
  "pitch .    .    .    .    .    .  ",
};

class OscSine final : public VoicedModule<osc::OscillatorState> {
  void process(ProcessContext& c) override {
    const ParamView fold = c.param(0);
    osc::render(
      c, st(c),
      [&fold](uint32_t i, uint32_t lane) {
        return SineShape{driveFor(static_cast<double>(lanes::lane(fold.at(i), lane)))};
      },
      // No Sync on this one: a folder is what shapes it. The core still handles a `reset` and an
      // outside `phase` exactly as it does for the others.
      [](uint32_t, uint32_t) { return 0.0; });
  }

  bool preview(const ParamValues& values, float* out, uint32_t count) override {
    const auto it = values.find("fold");
    const double fold = it == values.end() ? 0.0 : static_cast<double>(it->second);
    osc::preview(SineShape{driveFor(fold)}, 1.0, out, count);
    return true;
  }
};

}  // namespace

// Explicit `extern` (see AudioOut.cpp): a namespace-scope `const` is internal linkage by default.
extern const ModuleDescriptor kOscSine{kModuleAbiVersion, "osc.sine", "Sine", "Oscillators",
  "A sine with a wavefolder. Turning Fold up drives the wave through a sine curve, which folds it back on itself "
  "in round lobes and fills the spectrum with odd harmonics. At Fold 0 there is no folding and the wave is a "
  "plain sine. Fold is in semitones, so every twelve doubles how far the wave is driven: at twelve, two lobes "
  "meet at the centre. The face shows the resulting shape.",
  osc::kOscInputs, countOf(osc::kOscInputs), osc::kOscOutputs, countOf(osc::kOscOutputs),
  kParams, countOf(kParams), kModulePreviewsWave, 0,
  [] () -> Module* { return new OscSine(); }, kFace, countOf(kFace)};

}  // namespace pg::modules

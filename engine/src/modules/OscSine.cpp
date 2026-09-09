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
 * It is a curve with a cost at rest. At Fold 0 the drive is pi/2, which leaves the peak at full scale
 * but bends the wave on the way there, and the result carries a third harmonic eighteen decibels down.
 * The alternative -- a drive that starts from nothing -- gives up the doubling per octave that lines the
 * lobes up with the knob, so the faint harmonic is the price paid for the picture, and it is paid on
 * purpose.
 *
 * The wave keeps the antisymmetry across its half cycle that a sine has, so folding adds odd harmonics
 * and never an even one, and the tone brightens without ever jumping an octave.
 *
 * The cycle starts at the bottom rather than at zero -- `-cos` rather than `sin` -- so that a reset
 * begins with a rising edge, the way the sawtooth begins at -1 and the pulse begins high. That makes
 * the three oscillators agree about what phase 0 means, which matters as soon as one drives another's
 * `phase` input.
 *
 * The shape declares no steps, and needs no other correction either: this folder never breaks the
 * wave and, with `sin` for a curve, never even bends it sharply, so the curve band-limits itself. That
 * was measured rather than assumed. Averaging each sample across its phase interval -- exact for this
 * curve, and worth ten decibels when the curve was a triangle -- was tried here too and bought three to
 * five decibels in the one corner that is past saving anyway, and nothing where the instrument is
 * played, so it went. The numbers are in `test_osc_sine.cpp`.
 */
struct SineShape {
  /// How far the wave is driven into the folding curve: the argument `sin` sees at the wave's peak.
  /// pi/2 leaves the peak exactly at full scale; pi puts two lobes in each half of the cycle.
  double drive = M_PI / 2.0;

  float at(double phase) const { return static_cast<float>(std::sin(drive * unit(phase))); }

  uint32_t jumpCount() const { return 0; }
  osc::ShapeJump jump(uint32_t) const { return {0.0, 0.0}; }

  /// The sine before it is folded: a cosine starting at the bottom, -1..1.
  static double unit(double phase) { return -std::cos(2.0 * M_PI * phase); }
};

/**
 * Fold is measured in semitones, the same unit and the same 0..48 range as the other oscillators' Sync.
 *
 * Not decoration: an octave of fold is a doubling of how hard the wave is driven, exactly as an octave
 * of sync is a doubling of how fast it runs. At 0 st the drive is pi/2, the peak just touching full
 * scale; twelve semitones doubles it to pi and two round lobes meet at the centre line; twenty-four
 * puts four on the face; forty-eight drives the wave sixteen times over and fills the panel with
 * them. A linear knob would spend most of its travel in the last few.
 */
const ParamDesc kParams[] = {
  {"fold", "Fold", 0.f, 48.f, 0.f, ParamUnit::Semitones, ParamCurve::Linear,
   kParamPrimary | kParamModulatable, nullptr, 0, "knob", nullptr,
   "How hard the wave is driven past full scale before being reflected back, in semitones: every twelve "
   "doubles it, and each doubling folds another pair of lobes into the cycle"},
};

double driveFor(double semitones) { return (M_PI / 2.0) * std::exp2(std::clamp(semitones, 0.0, 48.0) / 12.0); }

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
extern const ModuleDescriptor kOscSine{kModuleAbiVersion, "osc.sine", "Sine", "osc",
  "A sine with a wavefolder. Turning Fold up drives the wave through a sine curve, which folds it back on itself "
  "in round lobes and fills the spectrum with odd harmonics. Fold is in semitones, so every twelve doubles the "
  "drive: at twelve, two lobes meet at the centre. The face shows the resulting shape.",
  osc::kOscInputs, countOf(osc::kOscInputs), osc::kOscOutputs, countOf(osc::kOscOutputs),
  kParams, countOf(kParams), kModulePreviewsWave, 0,
  [] () -> Module* { return new OscSine(); }, kFace, countOf(kFace)};

}  // namespace pg::modules

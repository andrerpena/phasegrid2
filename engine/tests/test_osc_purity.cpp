#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <cmath>
#include <map>
#include <string>
#include <vector>
#include "core/Engine.hpp"
#include "modules/builtin.hpp"
#include "render/OfflineRenderer.hpp"
#include "util/Harmonics.hpp"

/**
 * Is each oscillator the wave it says it is?
 *
 * This file exists because of a bug that took three rounds to find. `osc.sine` was a wavefolder whose
 * drive started at pi/2 rather than at zero, so at Fold 0 -- its default, and the setting anyone plays
 * first -- it was not a sine but a soft-clipped one, carrying a third harmonic eighteen decibels down.
 * Twelve percent distortion on the plainest note in the instrument.
 *
 * Every test we had passed. Level tests pass, because a flattened wave has an ordinary peak and a
 * slightly higher RMS. The discontinuity test passes, because a flattened wave has no discontinuity in
 * it at all. The aliasing test passes, because the extra harmonic is a real harmonic and lands exactly
 * on a harmonic bin. What nothing asked was the one question a listener asks immediately: is this a
 * sine? So that is what this file asks, of each of them, at the setting it ships with.
 *
 * A waveform *is* its harmonic series, so the assertion is the series itself against theory. The
 * fundamental is placed on an FFT bin (`onBin`) because otherwise leakage biases every ratio by enough
 * to let a genuinely wrong shape through -- see util/Harmonics.hpp.
 */
namespace {

constexpr double kSampleRate = 48000.0;
/// Low enough that nine harmonics are nowhere near half the sample rate, and on a bin.
const pg::test::OnBin kNote = pg::test::onBin(75, kSampleRate);   // about 220 Hz

/// pitch -> oscillator -> output, rendered long enough for one analysis window.
pg::test::HarmonicSeries seriesOf(const std::string& type, std::map<std::string, float> params) {
  pg::Registry reg;
  pg::Engine engine{reg, pg::EngineConfig{kSampleRate, 64}};
  pg::registerBuiltinModules(reg);
  REQUIRE(engine.model().addNode(reg, {"pitch", "math.scaleOffset", {{"offset", kNote.pitch}}}));
  REQUIRE(engine.model().addNode(reg, {"osc", type, std::move(params)}));
  REQUIRE(engine.model().addNode(reg, {"out", "io.audioOut", {}}));
  REQUIRE(engine.model().addEdge(reg, {"e1", "pitch", "out", "osc", "pitch"}));
  REQUIRE(engine.model().addEdge(reg, {"e2", "osc", "out", "out", "inL"}));
  REQUIRE(engine.commit());
  const std::vector<float> rendered = pg::renderInterleaved(engine, pg::RenderOptions{1.0, 2});
  return pg::test::harmonicSeries(pg::test::analysisWindow(rendered, kSampleRate, 0.5), kNote.bin);
}

/// The crest factor, peak over RMS: 1.414 for a sine, 1.732 for a sawtooth, 1 for a square. A second
/// opinion on the shape that owes nothing to the FFT, and the number that first showed the sine was
/// flat-topped -- it measured 1.24 where a sine must measure 1.41.
double crestOf(const std::string& type, std::map<std::string, float> params) {
  pg::Registry reg;
  pg::Engine engine{reg, pg::EngineConfig{kSampleRate, 64}};
  pg::registerBuiltinModules(reg);
  REQUIRE(engine.model().addNode(reg, {"pitch", "math.scaleOffset", {{"offset", kNote.pitch}}}));
  REQUIRE(engine.model().addNode(reg, {"osc", type, std::move(params)}));
  REQUIRE(engine.model().addNode(reg, {"out", "io.audioOut", {}}));
  REQUIRE(engine.model().addEdge(reg, {"e1", "pitch", "out", "osc", "pitch"}));
  REQUIRE(engine.model().addEdge(reg, {"e2", "osc", "out", "out", "inL"}));
  REQUIRE(engine.commit());
  const std::vector<float> rendered = pg::renderInterleaved(engine, pg::RenderOptions{1.0, 2});
  double sum = 0.0;
  double peak = 0.0;
  size_t n = 0;
  for (size_t i = static_cast<size_t>(0.5 * kSampleRate); i < static_cast<size_t>(0.9 * kSampleRate); ++i, ++n) {
    const double v = rendered[i * 2];
    sum += v * v;
    peak = std::max(peak, std::fabs(v));
  }
  return peak / std::sqrt(sum / static_cast<double>(n));
}

/// Loud enough to hear. A harmonic at -60 dB is inaudible under a fundamental; one at -18 dB, which is
/// what the sine used to carry, is a different instrument.
constexpr float kInaudible = 0.001f;   // -60 dB

}  // namespace

TEST_CASE("the sine is a sine", "[osc][purity]") {
  // Fold 0 means no folding: one partial and nothing else. This is the assertion the instrument was
  // missing. Before the drive was made to start from zero, harmonic 3 sat at 0.124 of the fundamental.
  const pg::test::HarmonicSeries s = seriesOf("osc.sine", {{"fold", 0.f}});
  for (int n = 2; n <= 9; ++n) {
    INFO("harmonic " << n << " is " << s[n] << " of the fundamental");
    REQUIRE(s[n] < kInaudible);
  }
  REQUIRE(crestOf("osc.sine", {{"fold", 0.f}}) == Catch::Approx(std::sqrt(2.0)).margin(0.01));
}

TEST_CASE("the sine folds only when it is asked to", "[osc][purity]") {
  // And at twelve semitones it is emphatically not a sine any more: odd harmonics, and no even ones,
  // because folding through `sin` keeps the wave antisymmetric across its half cycle.
  const pg::test::HarmonicSeries s = seriesOf("osc.sine", {{"fold", 12.f}});
  REQUIRE(s[3] > 0.1f);
  REQUIRE(s[2] < kInaudible);
  REQUIRE(s[4] < kInaudible);
  REQUIRE(s[6] < kInaudible);
}

TEST_CASE("the sawtooth is a sawtooth", "[osc][purity]") {
  // Every harmonic, falling as 1/n.
  const pg::test::HarmonicSeries s = seriesOf("osc.sawtooth", {{"sync", 0.f}});
  for (int n = 2; n <= 9; ++n) {
    INFO("harmonic " << n << " is " << s[n] << ", theory says " << 1.0 / n);
    REQUIRE(s[n] == Catch::Approx(1.0 / n).margin(0.02));
  }
  REQUIRE(crestOf("osc.sawtooth", {{"sync", 0.f}}) == Catch::Approx(std::sqrt(3.0)).margin(0.05));
}

TEST_CASE("the pulse at its default width is a square", "[osc][purity]") {
  // Odd harmonics falling as 1/n, and no even ones: a square is antisymmetric across its half cycle.
  const pg::test::HarmonicSeries s = seriesOf("osc.pulse", {{"sync", 0.f}});
  for (int n = 3; n <= 9; n += 2) {
    INFO("harmonic " << n << " is " << s[n] << ", theory says " << 1.0 / n);
    REQUIRE(s[n] == Catch::Approx(1.0 / n).margin(0.02));
  }
  for (int n = 2; n <= 8; n += 2) {
    INFO("harmonic " << n << " is " << s[n] << " and should not be there");
    REQUIRE(s[n] < 0.02f);
  }
  REQUIRE(crestOf("osc.pulse", {{"sync", 0.f}}) == Catch::Approx(1.0).margin(0.05));
}

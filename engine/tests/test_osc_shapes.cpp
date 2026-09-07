#include <algorithm>
#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_floating_point.hpp>
#include <cmath>
#include <string>
#include <vector>
#include "core/Engine.hpp"
#include "modules/builtin.hpp"
#include "render/OfflineRenderer.hpp"
#include "util/Harmonics.hpp"

/**
 * The four basic waveforms, measured rather than eyeballed.
 *
 * Every subtractive patch starts from sine, triangle, square/pulse or saw, so these are the shapes the
 * whole instrument is built on and the ones most worth pinning down. They come from the vendored
 * predefined wave frames through `WavetableBank`, which means a wrong table, a mislabelled enum entry or
 * a regression in the vendored render would otherwise be invisible: every one of those still produces a
 * confident-sounding tone, and a level or flatness check passes on all of them equally.
 *
 * So each shape is checked against its harmonic series, which is what actually distinguishes them:
 *
 *   sine      only the fundamental
 *   triangle  odd harmonics falling as 1/n^2
 *   square    odd harmonics falling as 1/n
 *   saw       every harmonic falling as 1/n
 *   pulse     every harmonic except multiples of four, the signature of a 25% duty cycle
 *
 * Square and saw share the same odd-harmonic ratios, so neither test would catch the two being swapped;
 * what separates them is the even harmonics, which the square must not have and the saw must.
 */

namespace {

constexpr double kSampleRate = 48000.0;
/// Bin 90: 263.67 Hz, a semitone-ish above middle C. See util/Harmonics.hpp for why a bin and not a note.
const pg::test::OnBin kF0 = pg::test::onBin(90, kSampleRate);

/// The built-in table indices, in the order `WavetableBank` declares them.
enum Table { kBasicShapes = 0, kSine = 1, kSaturatedSine = 2, kTriangle = 3, kSquare = 4, kPulse = 5, kSaw = 6 };

/// One built-in played on its own at `kF0`, with nothing else in the patch to colour it.
std::vector<float> renderShape(Table table, float waveFrame = 0.f) {
  pg::Registry reg;
  pg::registerBuiltinModules(reg);
  pg::Engine engine{reg, pg::EngineConfig{kSampleRate, 64}};
  REQUIRE(engine.model().addNode(reg, {"pitch", "math.scaleOffset", {{"offset", kF0.pitch}}}));
  REQUIRE(engine.model().addNode(reg, {"osc", "osc.wavetable",
                                       {{"table", static_cast<float>(table)}, {"wave_frame", waveFrame}}}));
  REQUIRE(engine.model().addNode(reg, {"out", "io.audioOut", {}}));
  REQUIRE(engine.model().addEdge(reg, {"e1", "pitch", "out", "osc", "pitch"}));
  REQUIRE(engine.model().addEdge(reg, {"e2", "osc", "out", "out", "inL"}));
  REQUIRE(engine.commit());
  return pg::renderInterleaved(engine, pg::RenderOptions{1.0, 2});
}

using Series = pg::test::HarmonicSeries;

/// Half a second in, well past any start-up ramp.
Series seriesOf(Table table, float waveFrame = 0.f) {
  return pg::test::harmonicSeries(pg::test::analysisWindow(renderShape(table, waveFrame), kSampleRate, 0.5), kF0.bin);
}

/// Within a tenth of the theoretical ratio. The table is band-limited and interpolated, so the harmonics
/// are close to theory rather than equal to it; a tenth is tight enough that no other basic shape fits.
void requireNear(float measured, double theory) {
  REQUIRE_THAT(measured, Catch::Matchers::WithinRel(static_cast<float>(theory), 0.1f));
}

constexpr float kAbsent = 0.02f;   // a harmonic the shape must not have

}  // namespace

TEST_CASE("the sine table is a single harmonic", "[osc][shapes]") {
  const Series s = seriesOf(kSine);
  for (int n = 2; n <= 9; ++n) {
    INFO("harmonic " << n);
    REQUIRE(s[n] < kAbsent);
  }
}

TEST_CASE("the triangle table has odd harmonics falling as 1/n^2", "[osc][shapes]") {
  const Series s = seriesOf(kTriangle);
  for (int n : {2, 4, 6, 8}) {
    INFO("even harmonic " << n);
    REQUIRE(s[n] < kAbsent);
  }
  requireNear(s[3], 1.0 / 9.0);
  requireNear(s[5], 1.0 / 25.0);
  requireNear(s[7], 1.0 / 49.0);
  requireNear(s[9], 1.0 / 81.0);
}

TEST_CASE("the square table has odd harmonics falling as 1/n", "[osc][shapes]") {
  const Series s = seriesOf(kSquare);
  // No even harmonics is what makes it a square rather than a saw: the two have identical odd series.
  for (int n : {2, 4, 6, 8}) {
    INFO("even harmonic " << n);
    REQUIRE(s[n] < kAbsent);
  }
  requireNear(s[3], 1.0 / 3.0);
  requireNear(s[5], 1.0 / 5.0);
  requireNear(s[7], 1.0 / 7.0);
  requireNear(s[9], 1.0 / 9.0);
}

TEST_CASE("the saw table has every harmonic falling as 1/n", "[osc][shapes]") {
  const Series s = seriesOf(kSaw);
  for (int n = 2; n <= 9; ++n) {
    INFO("harmonic " << n);
    requireNear(s[n], 1.0 / n);
  }
}

TEST_CASE("the pulse table is a quarter-width pulse", "[osc][shapes]") {
  // A pulse of duty d has harmonic n at |sin(pi*n*d)|/n, so a quarter width nulls every fourth harmonic
  // and leaves the rest. Those nulls are the only thing that tells this table apart from the square.
  const Series s = seriesOf(kPulse);
  for (int n : {4, 8}) {
    INFO("harmonic " << n << " must be a null of the quarter-width pulse");
    REQUIRE(s[n] < kAbsent);
  }
  const auto theory = [](int n) { return std::fabs(std::sin(M_PI * n * 0.25)) / n / (std::sin(M_PI * 0.25) / 1.0); };
  for (int n : {2, 3, 5, 6, 7, 9}) {
    INFO("harmonic " << n);
    requireNear(s[n], theory(n));
  }
}

TEST_CASE("the basic shapes table morphs sine to triangle to square to saw", "[osc][shapes]") {
  // Four keyframes evenly spaced over the table's 257 frames, which is what `wave_frame` scans.
  const Series sine = seriesOf(kBasicShapes, 0.f);
  for (int n = 2; n <= 9; ++n) REQUIRE(sine[n] < kAbsent);

  const Series triangle = seriesOf(kBasicShapes, 256.f / 3.f);
  REQUIRE(triangle[2] < kAbsent);
  requireNear(triangle[3], 1.0 / 9.0);

  const Series square = seriesOf(kBasicShapes, 2.f * 256.f / 3.f);
  REQUIRE(square[2] < kAbsent);
  requireNear(square[3], 1.0 / 3.0);

  const Series saw = seriesOf(kBasicShapes, 256.f);
  requireNear(saw[2], 1.0 / 2.0);
  requireNear(saw[3], 1.0 / 3.0);
}

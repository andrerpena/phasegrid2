#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_floating_point.hpp>
#include <cmath>
#include <functional>
#include <string>
#include <vector>
#include "core/Engine.hpp"
#include "modules/builtin.hpp"
#include "render/OfflineRenderer.hpp"
#include "util/Harmonics.hpp"
#include "util/RtGuard.hpp"

/**
 * `osc.pulse`, measured the same way the sawtooth is.
 *
 * Both run on the same core, so these tests are two claims at once: that a pulse is a pulse, and that
 * the core is genuinely general rather than a sawtooth with a switch in it. A square has only odd
 * harmonics where a saw has all of them, and nothing but the shape's own declaration of where it steps
 * decides which comes out.
 */

namespace {

constexpr double kSampleRate = 48000.0;

struct Rig {
  pg::Registry reg;
  pg::Engine engine{reg, pg::EngineConfig{kSampleRate, 64}};

  explicit Rig(float pitch, float sync, const std::function<void(Rig&)>& extra = {}) {
    pg::registerBuiltinModules(reg);
    REQUIRE(engine.model().addNode(reg, {"pitch", "math.scaleOffset", {{"offset", pitch}}}));
    REQUIRE(engine.model().addNode(reg, {"osc", "osc.pulse", {{"sync", sync}}}));
    REQUIRE(engine.model().addNode(reg, {"out", "io.audioOut", {}}));
    REQUIRE(engine.model().addEdge(reg, {"e1", "pitch", "out", "osc", "pitch"}));
    REQUIRE(engine.model().addEdge(reg, {"e2", "osc", "out", "out", "inL"}));
    if (extra) extra(*this);
    REQUIRE(engine.commit());
  }
  std::vector<float> render(double seconds) { return pg::renderInterleaved(engine, pg::RenderOptions{seconds, 2}); }
  std::vector<float> preview(uint32_t count) {
    std::vector<float> out(count);
    REQUIRE(engine.preview("osc", out.data(), count));
    return out;
  }
};

float left(const std::vector<float>& interleaved, size_t frame) { return interleaved[frame * 2]; }

double correlation(const std::vector<float>& a, const std::vector<float>& b) {
  REQUIRE(a.size() == b.size());
  double ab = 0.0, aa = 0.0, bb = 0.0;
  for (size_t i = 0; i < a.size(); ++i) {
    ab += static_cast<double>(a[i]) * b[i];
    aa += static_cast<double>(a[i]) * a[i];
    bb += static_cast<double>(b[i]) * b[i];
  }
  return ab / std::sqrt(aa * bb);
}

/// 200 Hz: a period of exactly 240 samples, so one cycle can be cut out of a render.
constexpr size_t kPeriod = 240;
const float kPeriodPitch = std::log2(200.f / pg::test::kMiddleCHzForTests) / 10.f;

}  // namespace

TEST_CASE("at 0 st the pulse is a square: odd harmonics only, falling as 1/n", "[osc][pulse]") {
  // What separates it from the sawtooth on the same core. A saw has every harmonic; a square has none
  // of the even ones, and that difference comes from nothing but the second step the shape declares.
  const pg::test::OnBin f0 = pg::test::onBin(90, kSampleRate);
  Rig rig{f0.pitch, 0.f};
  const pg::test::HarmonicSeries s =
      pg::test::harmonicSeries(pg::test::analysisWindow(rig.render(1.0), kSampleRate, 0.5), f0.bin);
  for (int n : {2, 4, 6, 8}) {
    INFO("even harmonic " << n);
    REQUIRE(s[n] < 0.02f);
  }
  for (int n : {3, 5, 7, 9}) {
    INFO("odd harmonic " << n);
    REQUIRE_THAT(s[n], Catch::Matchers::WithinRel(1.f / static_cast<float>(n), 0.1f));
  }
}

TEST_CASE("sync keeps the pulse at the master's pitch", "[osc][pulse]") {
  Rig rig{kPeriodPitch, 7.f};
  const std::vector<float> r = rig.render(1.0);
  float worst = 0.f;
  for (size_t i = 24000; i < 24000 + kPeriod * 20; ++i)
    worst = std::max(worst, std::fabs(left(r, i) - left(r, i + kPeriod)));
  REQUIRE(worst < 1e-3f);
}

TEST_CASE("sync packs more pulses into the cycle", "[osc][pulse]") {
  // What the knob does, and the thing you can see on the face. A square crosses zero twice per cycle of
  // itself. At 15 st the wave runs 2^(15/12) = 2.378 times faster, so within one master cycle it passes
  // its own half-way point at 0.5, 1.5 and its own start at 1.0, 2.0: four crossings, twice as many
  // pulses on the face. The reset back to the start falls on the cycle boundary itself.
  const auto crossings = [](const std::vector<float>& r) {
    int n = 0;
    for (size_t i = 24000; i < 24000 + kPeriod; ++i)
      if ((left(r, i) < 0.f) != (left(r, i + 1) < 0.f)) ++n;
    return n;
  };
  Rig plain{kPeriodPitch, 0.f};
  Rig wide{kPeriodPitch, 15.f};
  REQUIRE(crossings(plain.render(1.0)) == 2);
  REQUIRE(crossings(wide.render(1.0)) == 4);
}

TEST_CASE("the pulse sounds like the shape it draws", "[osc][pulse]") {
  for (const float sync : {0.f, 7.f, 15.f}) {
    INFO("sync " << sync << " st");
    Rig rig{kPeriodPitch, sync};
    const std::vector<float> r = rig.render(1.0);
    const std::vector<float> picture = rig.preview(kPeriod);
    double best = -1.0;
    for (int shift = -4; shift <= 4; ++shift) {
      std::vector<float> cycle(kPeriod);
      for (size_t i = 0; i < kPeriod; ++i) cycle[i] = left(r, static_cast<size_t>(24000 + shift) + i);
      best = std::max(best, correlation(cycle, picture));
    }
    REQUIRE(best > 0.97);
  }
}

TEST_CASE("the pulse preview is high for half the cycle", "[osc][pulse]") {
  Rig plain{kPeriodPitch, 0.f};
  const std::vector<float> square = plain.preview(240);
  REQUIRE(square[0] == Catch::Approx(1.f));
  REQUIRE(square[119] == Catch::Approx(1.f));
  REQUIRE(square[120] == Catch::Approx(-1.f));
  REQUIRE(square[239] == Catch::Approx(-1.f));

  // At 12 st the wave fits twice into the cycle, so it is high, low, high, low.
  Rig octave{kPeriodPitch, 12.f};
  const std::vector<float> twice = octave.preview(240);
  REQUIRE(twice[0] == Catch::Approx(1.f));
  REQUIRE(twice[60] == Catch::Approx(-1.f));
  REQUIRE(twice[120] == Catch::Approx(1.f));
  REQUIRE(twice[180] == Catch::Approx(-1.f));
}

TEST_CASE("a rising edge on Reset restarts the pulse", "[osc][pulse]") {
  const auto clock = [](Rig& r) {
    REQUIRE(r.engine.model().addNode(r.reg, {"clk", "phase.clock", {}}));
    REQUIRE(r.engine.model().addEdge(r.reg, {"e3", "clk", "trigger", "osc", "reset"}));
  };
  // A pitch that leaves the wave low where the reset lands, so the restart is visible: at middle C the
  // quarter note at 24000 samples falls 130.8 cycles in, which is past the halfway point.
  Rig free{0.f, 0.f};
  Rig reset{0.f, 0.f, clock};
  const std::vector<float> a = free.render(0.6), b = reset.render(0.6);
  REQUIRE(left(a, 24003) < -0.9f);
  REQUIRE(left(b, 24003) > 0.9f);
}

TEST_CASE("a connected Phase input replaces the pulse's own ramp", "[osc][pulse]") {
  const auto phase = [](Rig& r) {
    REQUIRE(r.engine.model().addNode(r.reg, {"ph", "math.scaleOffset", {{"offset", 0.25f}}}));
    REQUIRE(r.engine.model().addEdge(r.reg, {"e3", "ph", "out", "osc", "phase"}));
  };
  // A quarter of the way through, which is inside the high half, and a ramp that is not moving holds
  // it there. At 12 st the wave is twice as fast, so a quarter of the master is halfway through the
  // slave and the output is low instead: sync applies to an outside phase as it does to its own.
  Rig high{0.f, 0.f, phase};
  const std::vector<float> a = high.render(0.1);
  for (size_t i = 100; i < 4800; ++i) REQUIRE(left(a, i) == Catch::Approx(1.f).margin(1e-5f));
  Rig low{0.f, 12.f, phase};
  const std::vector<float> b = low.render(0.1);
  for (size_t i = 100; i < 4800; ++i) REQUIRE(left(b, i) == Catch::Approx(-1.f).margin(1e-5f));
}

TEST_CASE("the pulse is band-limited", "[osc][pulse]") {
  // The same bar the sawtooth is held to, and the same reason: a naive square at 2 kHz folds its top
  // harmonics back onto bins that are no harmonic at all.
  const pg::test::OnBin f0 = pg::test::onBin(683, kSampleRate);   // 2001.2 Hz
  Rig rig{f0.pitch, 0.f};
  const std::vector<float> mag = pg::test::magnitudeSpectrum(pg::test::analysisWindow(rig.render(1.0), kSampleRate, 0.5));
  double harmonic = 0.0, other = 0.0;
  for (size_t k = 4; k < mag.size(); ++k) {
    const size_t nearest = (k + f0.bin / 2) / f0.bin;
    const bool onHarmonic = nearest >= 1 && (k > nearest * f0.bin ? k - nearest * f0.bin : nearest * f0.bin - k) <= 2;
    (onHarmonic ? harmonic : other) += static_cast<double>(mag[k]) * mag[k];
  }
  const double dbDown = 10.0 * std::log10(harmonic / other);
  INFO("off-harmonic energy is " << dbDown << " dB below the harmonics");
  REQUIRE(dbDown > 30.0);
}

TEST_CASE("the pulse allocates nothing while rendering", "[osc][pulse][rt]") {
  Rig rig{0.f, 7.f};
  const std::vector<float> warm = rig.render(0.05);
  REQUIRE(std::fabs(left(warm, 2000)) > 0.f);
  std::vector<float> l(64), r(64);
  float* planar[2] = {l.data(), r.data()};
  pg::TransportSnapshot t;
  pg::test::resetRtViolations();
  {
    pg::test::RtScope scope;
    for (int i = 0; i < 200; ++i) rig.engine.renderBlock(planar, 2, 64, t);
  }
  REQUIRE(pg::test::rtViolations() == 0);
}

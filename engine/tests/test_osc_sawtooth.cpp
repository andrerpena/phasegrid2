#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_floating_point.hpp>
#include <cmath>
#include <map>
#include <string>
#include <vector>
#include "core/Engine.hpp"
#include "modules/builtin.hpp"
#include "render/OfflineRenderer.hpp"
#include "util/Harmonics.hpp"
#include "util/RtGuard.hpp"

/**
 * `osc.sawtooth`, measured.
 *
 * The saw is checked by its harmonic series; the sync by two properties that together define hard sync:
 * the pitch stays the master's, and the shape is the one the module itself draws. The last of those is
 * the test that ties the picture on the face to the sound in the speakers.
 */

namespace {

constexpr double kSampleRate = 48000.0;

struct Rig {
  pg::Registry reg;
  pg::Engine engine{reg, pg::EngineConfig{kSampleRate, 64}};

  /// A pitch source into the oscillator into the output. `extra` adds nodes and edges before the commit.
  explicit Rig(float pitch, float sync, const std::function<void(Rig&)>& extra = {}) {
    pg::registerBuiltinModules(reg);
    REQUIRE(engine.model().addNode(reg, {"pitch", "math.scaleOffset", {{"offset", pitch}}}));
    REQUIRE(engine.model().addNode(reg, {"osc", "osc.sawtooth", {{"sync", sync}}}));
    REQUIRE(engine.model().addNode(reg, {"out", "io.audioOut", {}}));
    REQUIRE(engine.model().addEdge(reg, {"e1", "pitch", "out", "osc", "pitch"}));
    REQUIRE(engine.model().addEdge(reg, {"e2", "osc", "out", "out", "inL"}));
    if (extra) extra(*this);
    REQUIRE(engine.commit());
  }
  std::vector<float> render(double seconds) { return pg::renderInterleaved(engine, pg::RenderOptions{seconds, 2}); }
  /// The module's own picture of itself at the current values.
  std::vector<float> preview(uint32_t count) {
    std::vector<float> out(count);
    REQUIRE(engine.preview("osc", out.data(), count));
    return out;
  }
};

float left(const std::vector<float>& interleaved, size_t frame) { return interleaved[frame * 2]; }

/// Normalised cross-correlation of two equal-length signals: 1 is the same shape, 0 is unrelated.
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

/// 200 Hz: a period of exactly 240 samples, so one cycle can be cut out of the render at a phase of 0.
constexpr double kPeriodHz = 200.0;
constexpr size_t kPeriod = 240;
const float kPeriodPitch = std::log2(static_cast<float>(kPeriodHz) / pg::test::kMiddleCHzForTests) / 10.f;

}  // namespace

TEST_CASE("at 0 st the sawtooth has every harmonic falling as 1/n", "[osc][sawtooth]") {
  const pg::test::OnBin f0 = pg::test::onBin(90, kSampleRate);
  Rig rig{f0.pitch, 0.f};
  const pg::test::HarmonicSeries s =
      pg::test::harmonicSeries(pg::test::analysisWindow(rig.render(1.0), kSampleRate, 0.5), f0.bin);
  for (int n = 2; n <= 9; ++n) {
    INFO("harmonic " << n);
    REQUIRE_THAT(s[n], Catch::Matchers::WithinRel(1.f / static_cast<float>(n), 0.1f));
  }
}

TEST_CASE("sync keeps the master's pitch", "[osc][sawtooth]") {
  // Seven semitones: the slave runs at 1.498 times the pitch and is cut off mid-ramp every cycle. Whatever
  // that does to the timbre, the waveform must still repeat every 240 samples, because that is what it
  // means for the pitch to be 200 Hz.
  Rig rig{kPeriodPitch, 7.f};
  const std::vector<float> r = rig.render(1.0);
  float worst = 0.f;
  for (size_t i = 24000; i < 24000 + kPeriod * 20; ++i)
    worst = std::max(worst, std::fabs(left(r, i) - left(r, i + kPeriod)));
  REQUIRE(worst < 1e-3f);
  // And it is not just a plain saw with a different name. A plain saw crosses zero twice a cycle: once
  // on the way up and once falling off the top. At 15 st the slave fits 2.4 ramps into the cycle, so
  // the wave crosses four times before the master cuts it off.
  Rig wide{kPeriodPitch, 15.f};
  const std::vector<float> w = wide.render(1.0);
  int crossings = 0;
  for (size_t i = 24000; i < 24000 + kPeriod; ++i)
    if ((left(w, i) < 0.f) != (left(w, i + 1) < 0.f)) ++crossings;
  REQUIRE(crossings == 4);
}

TEST_CASE("the sound is the shape the module draws", "[osc][sawtooth]") {
  // One rendered master cycle against the module's own preview at the same sync. The render is
  // band-limited and the preview is the ideal shape, so they agree closely rather than exactly.
  for (const float sync : {0.f, 7.f, 15.f}) {
    INFO("sync " << sync << " st");
    Rig rig{kPeriodPitch, sync};
    const std::vector<float> r = rig.render(1.0);
    const std::vector<float> picture = rig.preview(kPeriod);
    // Frame 24000 is exactly 100 cycles in, give or take the module's few samples of look-ahead, so
    // the cycle is cut at whichever nearby frame lines up best. Cutting a saw one sample off puts its
    // top at the start and ruins the match, which is not the disagreement this test is looking for.
    double best = -1.0;
    for (int shift = -4; shift <= 4; ++shift) {
      std::vector<float> cycle(kPeriod);
      for (size_t i = 0; i < kPeriod; ++i) cycle[i] = left(r, static_cast<size_t>(24000 + shift) + i);
      best = std::max(best, correlation(cycle, picture));
    }
    REQUIRE(best > 0.97);
  }
}

TEST_CASE("the preview is a ramp at 0 st and restarts halfway at 12 st", "[osc][sawtooth]") {
  Rig plain{kPeriodPitch, 0.f};
  const std::vector<float> ramp = plain.preview(240);
  REQUIRE(ramp[0] == Catch::Approx(-1.f));
  REQUIRE(ramp[239] == Catch::Approx(1.f - 2.f / 240.f));
  for (size_t i = 1; i < ramp.size(); ++i) REQUIRE(ramp[i] > ramp[i - 1]);

  Rig octave{kPeriodPitch, 12.f};
  const std::vector<float> two = octave.preview(240);
  REQUIRE(two[119] == Catch::Approx(1.f - 2.f / 120.f));
  REQUIRE(two[120] == Catch::Approx(-1.f));
}

TEST_CASE("a rising edge on Reset restarts the cycle", "[osc][sawtooth]") {
  // The clock's trigger fires at frame 0 and again at frame 24000 (a quarter note at 120 bpm). Without
  // the reset the ramp at 24003 is wherever 130.8 cycles of middle C left it; with it, at the bottom.
  const auto clock = [](Rig& r) {
    REQUIRE(r.engine.model().addNode(r.reg, {"clk", "phase.clock", {}}));
    REQUIRE(r.engine.model().addEdge(r.reg, {"e3", "clk", "trigger", "osc", "reset"}));
  };
  Rig free{0.f, 0.f};
  Rig reset{0.f, 0.f, clock};
  const std::vector<float> a = free.render(0.6), b = reset.render(0.6);
  REQUIRE(left(a, 24003) > 0.4f);
  REQUIRE(left(b, 24003) < -0.9f);
  // Between edges the two are the same wave: the reset at frame 0 put the restarted one exactly one
  // sample behind the free-running one, which is what a restart at the first sample means.
  REQUIRE(left(a, 11999) == Catch::Approx(left(b, 12000)).margin(1e-4f));
}

TEST_CASE("a connected Phase input replaces the internal ramp", "[osc][sawtooth]") {
  // A constant phase of 0.25 is a ramp that is not moving, so the output is one value: 2 * 0.25 - 1 at
  // 0 st. At 12 st the slave sits at twice the phase, 0.5, so the value is 0: sync applies to a phase
  // that came in from outside exactly as it does to the internal one.
  const auto phase = [](Rig& r) {
    REQUIRE(r.engine.model().addNode(r.reg, {"ph", "math.scaleOffset", {{"offset", 0.25f}}}));
    REQUIRE(r.engine.model().addEdge(r.reg, {"e3", "ph", "out", "osc", "phase"}));
  };
  Rig plain{0.f, 0.f, phase};
  const std::vector<float> a = plain.render(0.1);
  for (size_t i = 100; i < 4800; ++i) REQUIRE(left(a, i) == Catch::Approx(-0.5f).margin(1e-5f));
  Rig octave{0.f, 12.f, phase};
  const std::vector<float> b = octave.render(0.1);
  for (size_t i = 100; i < 4800; ++i) REQUIRE(left(b, i) == Catch::Approx(0.f).margin(1e-5f));
}

TEST_CASE("the sawtooth is band-limited", "[osc][sawtooth]") {
  // At a 2 kHz fundamental a naive saw's harmonics above Nyquist fold back onto bins that are no
  // harmonic at all. Measured: the naive saw puts that alias energy 12.5 dB below the harmonics, the
  // two-point PolyBLEP 27 dB, the four-point one this module uses 36.5 dB. The bar is set so the first
  // two fail and the third passes with room to spare.
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

TEST_CASE("the sawtooth allocates nothing while rendering", "[osc][sawtooth][rt]") {
  Rig rig{0.f, 7.f};
  const std::vector<float> warm = rig.render(0.05);
  REQUIRE(std::fabs(left(warm, 2000)) > 0.f);   // it is making sound, so the scope below measures something
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

#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_floating_point.hpp>
#include <cmath>
#include <cstdio>
#include <functional>
#include <string>
#include <vector>
#include "core/Engine.hpp"
#include "modules/builtin.hpp"
#include "render/OfflineRenderer.hpp"
#include "util/Harmonics.hpp"
#include "util/RtGuard.hpp"

namespace {

constexpr double kSampleRate = 48000.0;

struct Rig {
  pg::Registry reg;
  pg::Engine engine{reg, pg::EngineConfig{kSampleRate, 64}};

  explicit Rig(float pitch, float fold, const std::function<void(Rig&)>& extra = {}) {
    pg::registerBuiltinModules(reg);
    REQUIRE(engine.model().addNode(reg, {"pitch", "math.scaleOffset", {{"offset", pitch}}}));
    REQUIRE(engine.model().addNode(reg, {"osc", "osc.sine", {{"fold", fold}}}));
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

double aliasDb(const std::vector<float>& interleaved, size_t bin) {
  const std::vector<float> mag = pg::test::magnitudeSpectrum(pg::test::analysisWindow(interleaved, kSampleRate, 0.5));
  double harmonic = 0.0, other = 0.0;
  for (size_t k = 4; k < mag.size(); ++k) {
    const size_t nearest = (k + bin / 2) / bin;
    const bool on = nearest >= 1 && (k > nearest * bin ? k - nearest * bin : nearest * bin - k) <= 2;
    (on ? harmonic : other) += static_cast<double>(mag[k]) * mag[k];
  }
  return 10.0 * std::log10(harmonic / other);
}

}  // namespace

/**
 * `osc.sine`, measured.
 *
 * The fold is the whole module, and it has a signature no other control has: the wave stays
 * antisymmetric about its half cycle however hard it is driven, so the harmonics it adds are all odd.
 * A distortion that did anything else would show up here as an even harmonic.
 */

TEST_CASE("at Fold 0 the sine is very nearly pure", "[osc][sine]") {
  // Not perfectly: the folding curve is `sin`, and at rest the drive is pi/2, which bends the wave a
  // little on its way to the peak and leaves a third harmonic eighteen decibels down (measured 0.122 of
  // the fundamental) and nothing audible above it. That is the price of the curve whose lobes come out
  // round and meet at the centre line at twelve semitones, and it is paid on purpose; the comment on
  // `SineShape` says why the alternative was worse.
  const pg::test::OnBin f0 = pg::test::onBin(90, kSampleRate);
  Rig rig{f0.pitch, 0.f};
  const pg::test::HarmonicSeries s =
      pg::test::harmonicSeries(pg::test::analysisWindow(rig.render(1.0), kSampleRate, 0.5), f0.bin);
  REQUIRE(s[3] < 0.15f);
  REQUIRE(s[5] < 0.01f);
  for (int n : {2, 4, 6, 7, 8, 9}) {
    INFO("harmonic " << n);
    REQUIRE(s[n] < 0.005f);
  }
}
/// The energy above the fundamental, split by whether the harmonic is odd or even.
struct Content {
  double odd = 0.0;
  double even = 0.0;
};
Content contentOf(float fold) {
  const pg::test::OnBin f0 = pg::test::onBin(90, kSampleRate);
  Rig rig{f0.pitch, fold};
  const pg::test::HarmonicSeries s =
      pg::test::harmonicSeries(pg::test::analysisWindow(rig.render(1.0), kSampleRate, 0.5), f0.bin);
  Content c;
  for (int n = 2; n <= 9; ++n) (n % 2 ? c.odd : c.even) += static_cast<double>(s[n]) * s[n];
  return {std::sqrt(c.odd), std::sqrt(c.even)};
}

TEST_CASE("folding fills the spectrum with odd harmonics and never an even one", "[osc][sine]") {
  // Reflecting a wave back on itself is an odd operation applied to a wave already antisymmetric across
  // its half cycle, and the two together can only produce odd harmonics. That holds however hard the
  // wave is driven: measured across the knob's whole range the even harmonics are not small but zero.
  // An even one appearing would mean the fold had gone lopsided, which is what would happen if the wave
  // were driven up from its bottom rather than amplified about its middle.
  //
  // Which odd harmonics is another matter, and not something to pin down: folding moves energy between
  // them, and any one of them nulls at some setting -- the third all but vanishes at 24 st, where the
  // fifth is at its loudest. What is stable is that there is plenty of odd energy and no even energy.
  for (const float fold : {12.f, 24.f, 36.f, 48.f}) {
    INFO("fold " << fold << " st");
    const Content c = contentOf(fold);
    REQUIRE(c.even < 0.001);
    REQUIRE(c.odd > 1.0);
  }
}

TEST_CASE("the fold knob is what adds them", "[osc][sine]") {
  // Without it the spectrum would be the same at every setting and the knob would be decoration.
  REQUIRE(contentOf(0.f).odd < 0.15);
  REQUIRE(contentOf(12.f).odd > 1.0);
}
TEST_CASE("the sine sounds like the shape it draws", "[osc][sine]") {
  for (const float fold : {0.f, 24.f, 48.f}) {
    INFO("fold " << fold);
    Rig rig{kPeriodPitch, fold};
    const std::vector<float> r = rig.render(1.0);
    const std::vector<float> picture = rig.preview(kPeriod);
    double best = -1.0;
    for (int shift = -4; shift <= 4; ++shift) {
      std::vector<float> cycle(kPeriod);
      for (size_t i = 0; i < kPeriod; ++i) cycle[i] = left(r, static_cast<size_t>(24000 + shift) + i);
      best = std::max(best, correlation(cycle, picture));
    }
    // A shade looser than the sawtooth's 0.97, and honestly so: at 48 st the wave turns thirty-odd
    // times per cycle, and a band-limited rendering of that legitimately rounds what the ideal picture
    // draws as corners. The face is still showing the wave rather than an impression of it.
    REQUIRE(best > 0.95);
  }
}

TEST_CASE("the cycle starts at the bottom, like the sawtooth and the pulse", "[osc][sine]") {
  // A cosine turned upside down rather than a sine, so phase 0 is the bottom of the wave for all three
  // oscillators. They only agree about what a reset means, or about each other's `phase` input, if the
  // start of a cycle is the same place in every one of them.
  Rig rig{kPeriodPitch, 0.f};
  const std::vector<float> arch = rig.preview(240);
  REQUIRE(arch[0] == Catch::Approx(-1.f).margin(1e-5f));
  REQUIRE(arch[120] == Catch::Approx(1.f).margin(1e-5f));
  REQUIRE(arch[60] == Catch::Approx(0.f).margin(1e-5f));
}

TEST_CASE("at twelve semitones two round lobes meet at the centre line", "[osc][sine]") {
  // The picture the reference instrument draws at an octave of fold, and what fixes the scale of the
  // knob: the drive is exactly pi, so the wave passes through zero at the start, the quarter, the half
  // and the three-quarter, and rises to full scale between them. Two sines, merging.
  Rig rig{kPeriodPitch, 12.f};
  const std::vector<float> w = rig.preview(240);
  for (const size_t at : {0u, 60u, 120u, 180u}) {
    INFO("quarter " << at / 60);
    REQUIRE(w[at] == Catch::Approx(0.f).margin(1e-4f));
  }
  float top = -1.f, bottom = 1.f;
  for (const float v : w) {
    top = std::max(top, v);
    bottom = std::min(bottom, v);
  }
  REQUIRE(top == Catch::Approx(1.f).margin(0.01f));
  REQUIRE(bottom == Catch::Approx(-1.f).margin(0.01f));
}

TEST_CASE("fold turns one arch into many lobes", "[osc][sine]") {
  // What you see on the face as the knob goes round, counted rather than looked at.
  // Counted on the sign of the slope, skipping the flat stretches: the round curve sits on its peak
  // for several samples at a time, and a turn is where the wave was rising and is next falling, however
  // long it paused in between.
  const auto turns = [](const std::vector<float>& wave) {
    int n = 0;
    int last = 0;
    for (size_t i = 1; i < wave.size(); ++i) {
      const float d = wave[i] - wave[i - 1];
      const int sign = d > 1e-6f ? 1 : d < -1e-6f ? -1 : 0;
      if (sign == 0) continue;
      if (last != 0 && sign != last) ++n;
      last = sign;
    }
    return n;
  };
  Rig plain{kPeriodPitch, 0.f};
  Rig folded{kPeriodPitch, 48.f};
  REQUIRE(turns(plain.preview(512)) == 1);
  REQUIRE(turns(folded.preview(512)) > 6);
}
TEST_CASE("a rising edge on Reset restarts the sine", "[osc][sine]") {
  const auto clock = [](Rig& r) {
    REQUIRE(r.engine.model().addNode(r.reg, {"clk", "phase.clock", {}}));
    REQUIRE(r.engine.model().addEdge(r.reg, {"e3", "clk", "trigger", "osc", "reset"}));
  };
  Rig free{0.f, 0.f};
  Rig reset{0.f, 0.f, clock};
  const std::vector<float> a = free.render(0.6), b = reset.render(0.6);
  // The restarted one is at the bottom of its wave three samples after the edge; the free-running one is
  // 130.8 cycles into middle C and nowhere near it. Not exactly -1: a cosine leaves its minimum slowly,
  // so three samples in it has climbed to about -0.974, and the correction delay accounts for the rest.
  REQUIRE(left(b, 24003) < -0.95f);
  REQUIRE(left(a, 24003) > -0.9f);
}

TEST_CASE("a connected Phase input replaces the sine's own ramp", "[osc][sine]") {
  const auto phase = [](Rig& r) {
    REQUIRE(r.engine.model().addNode(r.reg, {"ph", "math.scaleOffset", {{"offset", 0.5f}}}));
    REQUIRE(r.engine.model().addEdge(r.reg, {"e3", "ph", "out", "osc", "phase"}));
  };
  // Halfway through the cycle is the top of the wave, and a ramp that is not moving holds it there.
  Rig rig{0.f, 0.f, phase};
  const std::vector<float> r = rig.render(0.1);
  for (size_t i = 100; i < 4800; ++i) REQUIRE(left(r, i) == Catch::Approx(1.f).margin(1e-4f));
}

TEST_CASE("the folded sine is band-limited", "[osc][sine]") {
  /*
   * Folding through `sin` never breaks the wave and never bends it sharply, so the curve band-limits
   * itself and there is no correction to apply. Measured, the off-harmonic energy below the harmonics,
   * in decibels:
   *
   *          0 st   12 st   24 st   36 st   48 st
   *   220 Hz  99.3    99.3    99.3    99.3    99.3
   *   439 Hz  99.1    98.3    96.4    92.6    87.4
   *   879 Hz  99.2    99.0    98.3    96.4    25.5
   *  2001 Hz  95.9    90.7    66.1     8.4    -3.9
   *
   * For the record, the triangle curve this replaced managed 27 dB at A4 fully folded and 6.5 dB at
   * 2 kHz; and averaging each sample across its phase interval, tried on top of `sin`, moved only the
   * bottom-right corner, by three to five decibels, so it was taken out again. That corner is
   * arithmetic rather than a defect: driven sixteen times over, the wave's harmonics reach twenty-five
   * times the pitch, and at 2 kHz that is past what any sample rate this engine runs at can hold. The
   * bar is set where the instrument is played: every fold setting at A4, and a plain sine at any pitch.
   */
  const pg::test::OnBin a4 = pg::test::onBin(150, kSampleRate);   // 439 Hz
  for (const float fold : {0.f, 12.f, 24.f, 36.f, 48.f}) {
    Rig rig{a4.pitch, fold};
    const double db = aliasDb(rig.render(1.0), a4.bin);
    INFO("fold " << fold << " st: off-harmonic energy is " << db << " dB below the harmonics");
    REQUIRE(db > 80.0);
  }
  const pg::test::OnBin high = pg::test::onBin(683, kSampleRate);
  Rig plain{high.pitch, 0.f};
  REQUIRE(aliasDb(plain.render(1.0), high.bin) > 90.0);
}
TEST_CASE("the sine allocates nothing while rendering", "[osc][sine][rt]") {
  Rig rig{0.f, 30.f};
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

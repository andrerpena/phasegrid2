#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <algorithm>
#include <cmath>
#include <functional>
#include <map>
#include <memory>
#include <string>
#include <vector>
#include "modules/builtin.hpp"
#include "util/GraphFixture.hpp"
#include "util/RtGuard.hpp"

/**
 * `mod.lfo`, measured.
 *
 * The claims worth checking are the ones a person patching it relies on: the rate is in hertz and
 * means it, the output swings exactly plus and minus the depth around zero, the shape knob morphs
 * through the four classic waves in the order its label promises, a reset restarts the cycle, and
 * the picture on its face is the wave it plays.
 */
namespace {

constexpr double kSampleRate = 48000.0;
constexpr uint32_t kBlock = 64;

struct Rig {
  pg::test::GraphFixture f;
  std::unique_ptr<pg::Program> program;

  explicit Rig(std::map<std::string, float> params, const std::function<void(pg::test::GraphFixture&)>& extra = {}) {
    pg::registerBuiltinModules(f.reg);
    f.node("lfo", "mod.lfo", std::move(params));
    if (extra) extra(f);
    program = f.compile(kSampleRate, kBlock);
  }
  /// Every frame of the LFO's output, lane 0, over `seconds`.
  std::vector<float> collect(double seconds) {
    const auto blocks = static_cast<size_t>(seconds * kSampleRate / kBlock);
    std::vector<float> v;
    v.reserve(blocks * kBlock);
    for (size_t b = 0; b < blocks; ++b) {
      f.run(*program, kBlock);
      for (uint32_t i = 0; i < kBlock; ++i) v.push_back(f.out(*program, "lfo", "out", i));
    }
    return v;
  }
  std::vector<float> preview(uint32_t count) {
    std::vector<float> out(count);
    for (const pg::NodeSlot& s : program->nodes)
      if (s.inst->id == "lfo") {
        pg::ParamValues values;
        for (const auto& [k, v] : f.model.nodes().at("lfo").params) values[k] = v;
        REQUIRE(s.inst->module->preview(values, out.data(), count));
      }
    return out;
  }
};

/// Upward crossings of `level`: how many times the wave climbed through it.
int risingCrossings(const std::vector<float>& v, float level) {
  int n = 0;
  for (size_t i = 1; i < v.size(); ++i)
    if (v[i - 1] < level && v[i] >= level) ++n;
  return n;
}

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

/// The ideal wave at `phase` for each corner of the shape knob, in the module's own convention: every
/// cycle starts at the bottom except the square, which starts high the way `osc.pulse` does.
float sineAt(double p) { return static_cast<float>(-std::cos(2.0 * M_PI * p)); }
float triangleAt(double p) { return static_cast<float>(p < 0.5 ? 4.0 * p - 1.0 : 3.0 - 4.0 * p); }
float sawAt(double p) { return static_cast<float>(2.0 * p - 1.0); }
float squareAt(double p) { return p < 0.5 ? 1.f : -1.f; }

std::vector<float> ideal(float (*shape)(double), size_t period, size_t count, float depth = 1.f) {
  std::vector<float> v(count);
  for (size_t i = 0; i < count; ++i) v[i] = depth * shape(static_cast<double>(i % period) / static_cast<double>(period));
  return v;
}

/// Drops the first sample of every half cycle. An accumulated phase lands a hair either side of the
/// exact value there, so a wave with a step at the wrap or at its middle (saw, square) can be one sample
/// late on it; that is the nature of a phase accumulator, not a wrong shape, and it must not be what
/// the comparison measures.
std::vector<float> awayFromWraps(const std::vector<float>& v, size_t period) {
  std::vector<float> out;
  out.reserve(v.size());
  for (size_t i = 0; i < v.size(); ++i)
    if (i % (period / 2) != 0) out.push_back(v[i]);
  return out;
}

}  // namespace

TEST_CASE("mod.lfo runs at the rate its knob says, in hertz", "[lfo]") {
  // A sine that starts at the bottom climbs through zero once per cycle, a quarter of the way in.
  Rig two({{"rate", 2.f}});
  REQUIRE(risingCrossings(two.collect(2.0), 0.f) == 4);
  Rig half({{"rate", 0.5f}});
  REQUIRE(risingCrossings(half.collect(4.0), 0.f) == 2);
}

TEST_CASE("mod.lfo swings plus and minus the depth around zero", "[lfo]") {
  Rig rig({{"rate", 4.f}, {"depth", 0.5f}});
  const std::vector<float> v = rig.collect(1.0);
  const auto [lo, hi] = std::minmax_element(v.begin(), v.end());
  REQUIRE(*hi == Catch::Approx(0.5f).margin(1e-3));
  REQUIRE(*lo == Catch::Approx(-0.5f).margin(1e-3));
  // Bipolar: the mean is zero, so the knob it feeds stays centred on its own value.
  double sum = 0.0;
  for (float x : v) sum += x;
  REQUIRE(sum / static_cast<double>(v.size()) == Catch::Approx(0.0).margin(1e-3));
}

TEST_CASE("mod.lfo's shape knob morphs sine, triangle, saw, square in that order", "[lfo]") {
  // 50 Hz is an integer period of 960 samples, so the ideal wave can be laid over the render exactly.
  const size_t period = 960;
  const size_t count = period * 4;
  const struct { float shape; float (*wave)(double); const char* name; } corners[] = {
    {0.f, sineAt, "sine"}, {1.f / 3.f, triangleAt, "triangle"}, {2.f / 3.f, sawAt, "saw"}, {1.f, squareAt, "square"}};
  for (const auto& corner : corners) {
    INFO(corner.name);
    Rig rig({{"rate", 50.f}, {"shape", corner.shape}});
    const std::vector<float> v = rig.collect(static_cast<double>(count) / kSampleRate);
    REQUIRE(correlation(awayFromWraps(v, period), awayFromWraps(ideal(corner.wave, period, count), period)) > 0.999);
  }
  // Halfway between two corners the wave is neither: a crossfade, not a switch.
  Rig between({{"rate", 50.f}, {"shape", 1.f / 6.f}});
  const std::vector<float> v = between.collect(static_cast<double>(count) / kSampleRate);
  REQUIRE(correlation(v, ideal(sineAt, period, count)) < 0.999);
  REQUIRE(correlation(v, ideal(triangleAt, period, count)) < 0.999);
  const std::vector<float> sine = ideal(sineAt, period, count), triangle = ideal(triangleAt, period, count);
  std::vector<float> mix(count);
  for (size_t i = 0; i < count; ++i) mix[i] = 0.5f * (sine[i] + triangle[i]);
  REQUIRE(correlation(v, mix) > 0.999);
}

TEST_CASE("a rising edge on reset restarts mod.lfo's cycle", "[lfo]") {
  // The impulse fires on the very first frame; a 5 Hz saw should then run 9600 frames and wrap, and the
  // wrap must land where the impulse says, not where the free-running phase would have put it.
  Rig rig({{"rate", 5.f}, {"shape", 2.f / 3.f}}, [](pg::test::GraphFixture& f) {
    f.node("hit", "test.impulse");
    f.edge("r", "hit.out", "lfo.reset");
  });
  const std::vector<float> v = rig.collect(0.5);
  REQUIRE(v[0] == Catch::Approx(-1.f).margin(1e-3));
  REQUIRE(v[4800] == Catch::Approx(0.f).margin(2e-3));
  REQUIRE(v[9599] > 0.99f);
  REQUIRE(v[9600] == Catch::Approx(-1.f).margin(1e-3));
}

TEST_CASE("mod.lfo draws the wave it plays", "[lfo]") {
  const size_t period = 960;
  Rig rig({{"rate", 50.f}, {"shape", 0.5f}, {"depth", 0.7f}});
  std::vector<float> v = rig.collect(static_cast<double>(period) / kSampleRate);
  v.resize(period);
  REQUIRE(correlation(v, rig.preview(static_cast<uint32_t>(period))) > 0.999);
  // Depth is in the picture too, so the face shows a quiet LFO as quiet. Measured on the plain sine:
  // halfway through a morph the peaks of the two neighbours do not line up, and the wave is shorter.
  Rig quiet({{"shape", 0.f}, {"depth", 0.7f}});
  const std::vector<float> pic = quiet.preview(64);
  REQUIRE(*std::max_element(pic.begin(), pic.end()) == Catch::Approx(0.7f).margin(0.02));
}

TEST_CASE("mod.lfo's rate follows a signal on its rate input", "[lfo]") {
  // Rate is a log knob over four decades, so a quarter of its normalized range is one decade: 2 Hz
  // becomes 20 Hz. Modulation adds in normalized units, which is the engine's rule for every knob.
  Rig rig({{"rate", 2.f}}, [](pg::test::GraphFixture& f) {
    f.node("more", "test.const", {{"value", 0.25f}});
    f.edge("m", "more.out", "lfo.param:rate");
  });
  REQUIRE(risingCrossings(rig.collect(1.0), 0.f) == Catch::Approx(20).margin(1));
}

TEST_CASE("mod.lfo allocates nothing while it runs", "[lfo][rt]") {
  Rig rig({{"rate", 3.f}});
  const std::vector<float> warm = rig.collect(0.5);
  REQUIRE(*std::max_element(warm.begin(), warm.end()) > 0.5f);   // proven audible before measuring
  {
    pg::test::RtScope rt;
    for (int b = 0; b < 200; ++b) rig.f.run(*rig.program, kBlock);
  }
}

#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <algorithm>
#include <cmath>
#include <map>
#include <memory>
#include <string>
#include <vector>
#include "modules/builtin.hpp"
#include "util/GraphFixture.hpp"
#include "util/RtGuard.hpp"

namespace {

/// One modulator with a held gate, read straight off its own output buffer.
struct Rig {
  pg::test::GraphFixture f;
  std::unique_ptr<pg::Program> program;
  std::string node;

  Rig(const char* type, std::map<std::string, float> params) : node("m") {
    pg::registerBuiltinModules(f.reg);
    f.node("hi", "test.const", {{"value", 1.f}});
    f.node(node, type, std::move(params));
    f.edge("gate", "hi.out", "m.gate");
    program = f.compile();
  }
  void run(int blocks) { for (int b = 0; b < blocks; ++b) f.run(*program, 64); }
  /// Runs `blocks` blocks of 64 frames and returns every frame of the module's `out` port, lane 0.
  std::vector<float> collect(int blocks, const char* port = "out") {
    std::vector<float> v;
    v.reserve(static_cast<size_t>(blocks) * 64);
    for (int b = 0; b < blocks; ++b) {
      f.run(*program, 64);
      for (uint32_t i = 0; i < 64; ++i) v.push_back(f.out(*program, node, port, i));
    }
    return v;
  }
};

/// Counts upward crossings of `level`, i.e. how many times the signal restarted its climb.
int risingCrossings(const std::vector<float>& v, float level) {
  int n = 0;
  for (size_t i = 1; i < v.size(); ++i)
    if (v[i - 1] < level && v[i] >= level) ++n;
  return n;
}

// `frequency` is a power of two in hertz, `sync` 0 = Seconds (free running), `sync_type` 0 = Trigger.
const std::map<std::string, float> kFourHertzSine = {
  {"shape", 0.f}, {"frequency", 2.f}, {"sync", 0.f}, {"sync_type", 0.f}};

}  // namespace

TEST_CASE("mod.lfo descriptor is generated from the vendored parameter table", "[vital]") {
  pg::Registry reg;
  pg::registerBuiltinModules(reg);
  const pg::RegisteredModule* m = reg.find("mod.lfo");
  REQUIRE(m != nullptr);
  REQUIRE(m->findInput("gate") == 0);
  REQUIRE(m->findInput("count") == 1);
  REQUIRE(m->findInput("pitch") == 2);
  REQUIRE(m->findOutput("out") == 0);
  REQUIRE(m->findOutput("phase") == 1);
  REQUIRE(m->findOutput("frequency") == 2);

  // The spec's own `shape` plus the twelve controls the vendored module creates, including the three the
  // tempo-sync switch adds behind the scenes (`tempo`, `sync`, and the pair of keytrack trims).
  for (const char* id : {"shape", "frequency", "phase", "fade_time", "delay_time", "stereo", "sync_type",
                         "smooth_mode", "smooth_time", "tempo", "sync", "keytrack_transpose", "keytrack_tune"})
    REQUIRE(m->findParam(id) >= 0);
  REQUIRE(m->desc->numParams == 13);
  for (uint32_t i = 0; i < m->desc->numParams; ++i)
    REQUIRE(std::string(m->desc->params[i].id).find("lfo_1") == std::string::npos);

  const pg::ParamDesc& shape = m->desc->params[m->findParam("shape")];
  REQUIRE((shape.flags & pg::kParamStructural) != 0);
  REQUIRE(shape.enumCount == 5);
  REQUIRE(std::string(shape.enumLabels[2]) == "Square");

  // `sync` really is in the vendored parameter table, so its labels are generated rather than hand-written.
  const pg::ParamDesc& sync = m->desc->params[m->findParam("sync")];
  REQUIRE(sync.enumCount == 5);
  REQUIRE(std::string(sync.enumLabels[0]) == "Seconds");

  const pg::ParamDesc& frequency = m->desc->params[m->findParam("frequency")];
  REQUIRE(frequency.min == Catch::Approx(-7.f));
  REQUIRE(frequency.max == Catch::Approx(9.f));
  REQUIRE((frequency.flags & pg::kParamModulatable) != 0);
  REQUIRE(m->findInput("param:frequency") >= 0);
}

TEST_CASE("mod.lfo runs a full-rate cycle at the frequency its knob asks for", "[vital]") {
  Rig rig("mod.lfo", kFourHertzSine);
  const std::vector<float> v = rig.collect(750);   // one second at 48 kHz in blocks of 64

  const float lo = *std::min_element(v.begin(), v.end());
  const float hi = *std::max_element(v.begin(), v.end());
  REQUIRE(hi > 0.9f);    // the vendored LFO is unipolar: the line source runs 0..1
  REQUIRE(lo < 0.1f);
  REQUIRE(risingCrossings(v, 0.5f) == Catch::Approx(4).margin(1));

  // Not a stepped block-rate signal: within a single block the value moves.
  REQUIRE(v[300] != v[301]);

  // The `frequency` readout is one of the two outputs the vendored oscillator writes only at buffer[0]. It
  // has to be broadcast across the block, so the LAST frame carries the rate too, not a stale zero.
  const std::vector<float> hz = rig.collect(2, "frequency");
  REQUIRE(hz[63] == Catch::Approx(4.f));
  REQUIRE(hz[127] == Catch::Approx(4.f));

  // Halving the rate halves the cycle count, which it cannot do unless the knob reaches the oscillator.
  std::map<std::string, float> slower = kFourHertzSine;
  slower["frequency"] = 1.f;   // 2 Hz
  Rig slow("mod.lfo", slower);
  REQUIRE(risingCrossings(slow.collect(750), 0.5f) == Catch::Approx(2).margin(1));
}

TEST_CASE("mod.lfo shape picks the wave the line source renders", "[vital]") {
  // A square spends its time at the two extremes; a sine spends most of it in between. Anything that fails to
  // apply the structural shape param leaves both graphs running the same default line.
  auto middleFraction = [](const std::vector<float>& v) {
    int middle = 0;
    for (float x : v) if (x > 0.2f && x < 0.8f) ++middle;
    return static_cast<float>(middle) / static_cast<float>(v.size());
  };

  Rig sine("mod.lfo", kFourHertzSine);
  std::map<std::string, float> squareParams = kFourHertzSine;
  squareParams["shape"] = 2.f;
  Rig square("mod.lfo", squareParams);

  REQUIRE(middleFraction(sine.collect(200)) > 0.3f);
  REQUIRE(middleFraction(square.collect(200)) < 0.1f);
}

TEST_CASE("mod.lfo steady state is allocation free", "[vital][rt]") {
  Rig rig("mod.lfo", kFourHertzSine);
  const std::vector<float> warm = rig.collect(100);              // half a cycle at 4 Hz, so it reaches the top
  REQUIRE(*std::max_element(warm.begin(), warm.end()) > 0.9f);   // really running, so the check below has a subject
  pg::test::resetRtViolations();
  { pg::test::RtScope scope; rig.run(200); }
  REQUIRE(pg::test::rtViolations() == 0);
}

TEST_CASE("mod.random descriptor is generated from the vendored parameter table", "[vital]") {
  pg::Registry reg;
  pg::registerBuiltinModules(reg);
  const pg::RegisteredModule* m = reg.find("mod.random");
  REQUIRE(m != nullptr);
  REQUIRE(m->findInput("gate") == 0);
  REQUIRE(m->findInput("pitch") == 1);
  REQUIRE(m->findOutput("out") == 0);
  for (const char* id : {"style", "frequency", "stereo", "sync_type", "tempo", "sync",
                         "keytrack_transpose", "keytrack_tune"})
    REQUIRE(m->findParam(id) >= 0);
  REQUIRE(m->desc->numParams == 8);

  const pg::ParamDesc& style = m->desc->params[m->findParam("style")];
  REQUIRE(style.enumCount == 4);
  REQUIRE(std::string(style.enumLabels[1]) == "Sample & Hold");
}

TEST_CASE("mod.random wanders between 0 and 1 at the rate its knob asks for", "[vital]") {
  auto turningPoints = [](const std::vector<float>& v) {
    int n = 0;
    for (size_t i = 1; i + 1 < v.size(); ++i)
      if ((v[i] - v[i - 1]) * (v[i + 1] - v[i]) < 0.f) ++n;
    return n;
  };

  // Sample & hold, so the signal is a staircase whose step count is the rate: 2^3 = 8 Hz over one second.
  Rig fast("mod.random", {{"style", 1.f}, {"frequency", 3.f}, {"sync", 0.f}, {"sync_type", 0.f}});
  const std::vector<float> f = fast.collect(750);
  REQUIRE(*std::min_element(f.begin(), f.end()) >= 0.f);
  REQUIRE(*std::max_element(f.begin(), f.end()) <= 1.f);

  int steps = 0;
  for (size_t i = 1; i < f.size(); ++i) if (f[i] != f[i - 1]) ++steps;
  REQUIRE(steps == Catch::Approx(8).margin(2));

  // Perlin at the same rate is continuous rather than stepped, so it turns around instead of jumping.
  Rig perlin("mod.random", {{"style", 0.f}, {"frequency", 3.f}, {"sync", 0.f}, {"sync_type", 0.f}});
  const std::vector<float> p = perlin.collect(750);
  REQUIRE(*std::max_element(p.begin(), p.end()) - *std::min_element(p.begin(), p.end()) > 0.1f);
  REQUIRE(turningPoints(p) > turningPoints(f));
}

TEST_CASE("mod.random steady state is allocation free", "[vital][rt]") {
  Rig rig("mod.random", {{"style", 0.f}, {"frequency", 4.f}, {"sync", 0.f}, {"sync_type", 0.f}});
  const std::vector<float> warm = rig.collect(100);              // really running, so the check below has a subject
  REQUIRE(*std::max_element(warm.begin(), warm.end()) - *std::min_element(warm.begin(), warm.end()) > 0.05f);
  pg::test::resetRtViolations();
  { pg::test::RtScope scope; rig.run(200); }
  REQUIRE(pg::test::rtViolations() == 0);
}

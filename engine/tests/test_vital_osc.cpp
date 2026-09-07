#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <cmath>
#include <string>
#include <vector>
#include "core/Engine.hpp"
#include "modules/TestModules.hpp"
#include "modules/builtin.hpp"
#include "util/RtGuard.hpp"

namespace {

struct Rig {
  pg::Registry reg;
  pg::Engine engine{reg, pg::EngineConfig{48000.0, 64}};
  pg::TransportSnapshot t;
  std::vector<float> l = std::vector<float>(64), r = std::vector<float>(64);
  float* out[2] = {l.data(), r.data()};
  Rig() { pg::registerBuiltinModules(reg); pg::test::registerTestModules(reg); }

  void render(int blocks) { for (int i = 0; i < blocks; ++i) engine.renderBlock(out, 2, 64, t); }

  /// Fundamental estimate by counting upward zero crossings of the left channel.
  float measureHz(int blocks) {
    int crossings = 0;
    float prev = 0.f;
    for (int b = 0; b < blocks; ++b) {
      engine.renderBlock(out, 2, 64, t);
      for (const float v : l) {
        if (prev <= 0.f && v > 0.f) ++crossings;
        prev = v;
      }
    }
    return static_cast<float>(crossings) / (static_cast<float>(blocks * 64) / 48000.f);
  }

  float rms(int blocks) {
    double sum = 0;
    int n = 0;
    for (int b = 0; b < blocks; ++b) {
      engine.renderBlock(out, 2, 64, t);
      for (const float v : l) { sum += static_cast<double>(v) * v; ++n; }
    }
    return static_cast<float>(std::sqrt(sum / n));
  }

  /// A gated, pitched oscillator into the sink. `pitch` is in phasegrid pitch units.
  void buildVoice(float pitch, std::map<std::string, float> oscParams) {
    REQUIRE(engine.model().addNode(reg, {"gate", "test.const", {{"value", 1.f}}}));
    REQUIRE(engine.model().addNode(reg, {"pitch", "test.const", {{"value", pitch}}}));
    REQUIRE(engine.model().addNode(reg, {"osc", "osc.wavetable", std::move(oscParams)}));
    REQUIRE(engine.model().addNode(reg, {"s", "test.sink", {}}));
    REQUIRE(engine.model().addEdge(reg, {"e1", "gate", "out", "osc", "gate"}));
    REQUIRE(engine.model().addEdge(reg, {"e2", "pitch", "out", "osc", "pitch"}));
    REQUIRE(engine.model().addEdge(reg, {"e3", "osc", "out", "s", "in"}));
    REQUIRE(engine.commit());
  }
};

}  // namespace

TEST_CASE("osc.wavetable descriptor: structural table enum, generated params, ports", "[vital]") {
  Rig rig;
  const pg::RegisteredModule* o = rig.reg.find("osc.wavetable");
  REQUIRE(o != nullptr);
  REQUIRE(o->findInput("gate") == 0);
  REQUIRE(o->findInput("retrigger") == 1);
  REQUIRE(o->findInput("pitch") == 2);
  REQUIRE(o->findInput("voices") == 3);
  REQUIRE(o->findOutput("out") == 0);
  REQUIRE(o->findOutput("raw") == 1);

  // The spec's own extra param comes before every generated one, so it is param 0.
  const int32_t table = o->findParam("table");
  REQUIRE(table == 0);
  REQUIRE((o->desc->params[table].flags & pg::kParamStructural) != 0);
  REQUIRE((o->desc->params[table].flags & pg::kParamEnum) != 0);
  REQUIRE((o->desc->params[table].flags & pg::kParamModulatable) == 0);   // structural params are never modulatable
  REQUIRE(o->desc->params[table].enumCount == 7);
  REQUIRE(std::string(o->desc->params[table].enumLabels[1]) == "Sine");
  REQUIRE(o->findInput("param:table") == -1);

  const int32_t level = o->findParam("level");
  REQUIRE(level >= 0);
  REQUIRE((o->desc->params[level].flags & pg::kParamModulatable) != 0);
  REQUIRE(o->findInput("param:level") >= 0);

  const int32_t waveFrame = o->findParam("wave_frame");
  REQUIRE(waveFrame >= 0);
  REQUIRE(o->desc->params[waveFrame].max == Catch::Approx(256.f));

  const int32_t voices = o->findParam("unison_voices");
  REQUIRE(voices >= 0);
  REQUIRE((o->desc->params[voices].flags & pg::kParamInteger) != 0);
  REQUIRE(o->desc->params[voices].min == Catch::Approx(1.f));
  REQUIRE(o->desc->params[voices].max == Catch::Approx(16.f));

  const int32_t transpose = o->findParam("transpose");
  REQUIRE(transpose >= 0);
  REQUIRE(o->desc->params[transpose].min == Catch::Approx(-48.f));
  REQUIRE(o->desc->params[transpose].max == Catch::Approx(48.f));

  REQUIRE(o->findParam("on") == -1);        // always on: there is no bypass knob on a grid module
  REQUIRE(o->findParam("view_2d") == -1);   // host editor control, and its name table is shorter than its range
  for (uint32_t i = 0; i < o->desc->numParams; ++i)
    REQUIRE(std::string(o->desc->params[i].id).find("osc_1") == std::string::npos);
}

TEST_CASE("osc.wavetable tracks the pitch input and the transpose knob", "[vital]") {
  Rig rig;
  rig.buildVoice(0.1f, {{"table", 1.f}, {"unison_voices", 1.f}});   // Sine, one octave above middle C
  rig.render(20);
  REQUIRE(rig.measureHz(100) == Catch::Approx(523.25f).epsilon(0.03f));

  REQUIRE(rig.engine.setParam("osc", "transpose", 12.f));
  rig.render(20);
  REQUIRE(rig.measureHz(100) == Catch::Approx(1046.5f).epsilon(0.03f));
}

TEST_CASE("osc.wavetable plays the wavetable the structural param selects", "[vital]") {
  // A sine and a square at the same level differ in RMS by their crest factors (0.707 vs 1.0 of peak), so the
  // measurement fails if `table` is ignored and both instances render the same built-in.
  auto rmsOf = [](float table) {
    Rig rig;
    rig.buildVoice(0.f, {{"table", table}, {"unison_voices", 1.f}, {"level", 1.f}, {"random_phase", 0.f}});
    rig.render(20);
    return rig.rms(50);
  };
  const float sine = rmsOf(1.f), square = rmsOf(4.f);
  REQUIRE(sine > 0.2f);
  REQUIRE(square > sine * 1.2f);
}

TEST_CASE("osc.wavetable rebuilds its instance when the wavetable changes", "[vital]") {
  Rig rig;
  rig.buildVoice(0.f, {{"table", 1.f}, {"unison_voices", 1.f}, {"level", 1.f}, {"random_phase", 0.f}});
  rig.render(20);
  const float sine = rig.rms(50);

  REQUIRE(rig.engine.model().setParam(rig.reg, "osc", "table", 4.f));   // model only: structural, so acquire rebuilds
  REQUIRE(rig.engine.commit());
  rig.render(20);
  REQUIRE(rig.rms(50) > sine * 1.2f);
}

TEST_CASE("osc.wavetable steady state is allocation free", "[vital][rt]") {
  Rig rig;
  rig.buildVoice(0.f, {{"table", 0.f}, {"unison_voices", 4.f}});
  REQUIRE(rig.engine.model().addNode(rig.reg, {"mod", "test.const", {{"value", 0.25f}}}));
  REQUIRE(rig.engine.model().addEdge(rig.reg, {"e4", "mod", "out", "osc", "param:wave_frame"}));
  REQUIRE(rig.engine.commit());
  rig.render(64);   // warm up: the oscillator fills its frequency bins lazily on the first blocks
  REQUIRE(rig.rms(10) > 0.01f);   // an allocation-free silence would pass the check below for the wrong reason
  pg::test::resetRtViolations();
  { pg::test::RtScope scope; rig.render(200); }
  REQUIRE(pg::test::rtViolations() == 0);
}

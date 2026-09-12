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
  float rmsAfterSettle(int settleBlocks, int measureBlocks) {
    for (int i = 0; i < settleBlocks; ++i) engine.renderBlock(out, 2, 64, t);
    double s = 0; int n = 0;
    for (int i = 0; i < measureBlocks; ++i) {
      engine.renderBlock(out, 2, 64, t);
      for (float v : l) { s += static_cast<double>(v) * v; ++n; }
    }
    return static_cast<float>(std::sqrt(s / n));
  }
};
}  // namespace

TEST_CASE("filter.multi descriptor is generated from the vendored parameter table", "[vital]") {
  Rig rig;
  const pg::RegisteredModule* f = rig.reg.find("filter.multi");
  REQUIRE(f != nullptr);
  REQUIRE(f->findInput("in") == 0);
  REQUIRE(f->findInput("reset") == 1);
  REQUIRE(f->findInput("pitch") == 2);
  REQUIRE(f->findInput("keytrack") == 3);
  REQUIRE(f->findOutput("out") == 0);

  const int32_t cutoff = f->findParam("cutoff");
  REQUIRE(cutoff >= 0);
  REQUIRE(f->desc->params[cutoff].min == Catch::Approx(8.f));
  REQUIRE(f->desc->params[cutoff].max == Catch::Approx(136.f));
  REQUIRE(f->desc->params[cutoff].def == Catch::Approx(60.f));
  REQUIRE(f->desc->params[cutoff].unit == pg::ParamUnit::Semitones);
  REQUIRE((f->desc->params[cutoff].flags & pg::kParamModulatable) != 0);
  REQUIRE(f->findInput("param:cutoff") >= 0);

  const int32_t model = f->findParam("model");
  REQUIRE(model >= 0);
  REQUIRE((f->desc->params[model].flags & pg::kParamEnum) != 0);
  REQUIRE((f->desc->params[model].flags & pg::kParamModulatable) == 0);
  REQUIRE(f->desc->params[model].enumCount == 8);
  REQUIRE(std::string(f->desc->params[model].enumLabels[3]) == "Digital");
  REQUIRE(f->findInput("param:model") == -1);   // a stepped param gets no implicit modulation port

  // `style` names differ per model and the vendored name table is shorter than the param's range, so it is
  // an unlabelled index rather than an enum whose labels would be read off the end of that table.
  const int32_t style = f->findParam("style");
  REQUIRE(style >= 0);
  REQUIRE((f->desc->params[style].flags & pg::kParamInteger) != 0);
  REQUIRE((f->desc->params[style].flags & pg::kParamEnum) == 0);
  REQUIRE(f->desc->params[style].enumLabels == nullptr);

  REQUIRE(f->findParam("on") == -1);          // no bypass knob: a grid module is always on
  REQUIRE(f->findParam("osc1_input") == -1);  // routing controls of the host synth are not our concern
  for (uint32_t i = 0; i < f->desc->numParams; ++i)
    REQUIRE(std::string(f->desc->params[i].id).find("filter_1") == std::string::npos);
}

TEST_CASE("filter.multi passes DC through a low pass", "[vital]") {
  Rig rig;
  REQUIRE(rig.engine.model().addNode(rig.reg, {"src", "test.const", {{"value", 0.5f}}}));
  REQUIRE(rig.engine.model().addNode(rig.reg, {"f", "filter.multi", {{"model", 3.f}, {"cutoff", 83.f}, {"resonance", 0.3f}}}));
  REQUIRE(rig.engine.model().addNode(rig.reg, {"s", "test.sink", {}}));
  REQUIRE(rig.engine.model().addEdge(rig.reg, {"e1", "src", "out", "f", "in"}));
  REQUIRE(rig.engine.model().addEdge(rig.reg, {"e2", "f", "out", "s", "in"}));
  REQUIRE(rig.engine.commit());
  REQUIRE(rig.rmsAfterSettle(50, 10) == Catch::Approx(0.5f).margin(0.05f));
}

TEST_CASE("filter.multi routes modulation into the control-rate destination", "[vital]") {
  // Digital model, blend 2 = high pass, so the wet signal has no DC at all and the output is exactly the dry
  // signal scaled by (1 - mix). That turns `mix` into a direct readout of the value the module actually saw.
  Rig rig;
  REQUIRE(rig.engine.model().addNode(rig.reg, {"src", "test.const", {{"value", 0.5f}}}));
  REQUIRE(rig.engine.model().addNode(rig.reg,
                                     {"f", "filter.multi", {{"model", 3.f}, {"blend", 2.f}, {"cutoff", 83.f}, {"mix", 1.f}}}));
  REQUIRE(rig.engine.model().addNode(rig.reg, {"s", "test.sink", {}}));
  REQUIRE(rig.engine.model().addEdge(rig.reg, {"e1", "src", "out", "f", "in"}));
  REQUIRE(rig.engine.model().addEdge(rig.reg, {"e2", "f", "out", "s", "in"}));
  REQUIRE(rig.engine.commit());
  REQUIRE(rig.rmsAfterSettle(50, 10) == Catch::Approx(0.f).margin(0.01f));   // fully wet: no DC survives

  REQUIRE(rig.engine.model().addNode(rig.reg, {"mod", "test.const", {{"value", -0.5f}}}));
  REQUIRE(rig.engine.model().addEdge(rig.reg, {"e3", "mod", "out", "f", "param:mix"}));
  REQUIRE(rig.engine.commit());
  REQUIRE(rig.rmsAfterSettle(50, 10) == Catch::Approx(0.25f).margin(0.01f));   // mix 0.5: half the dry DC
}

TEST_CASE("filter.multi routes modulation into the audio-rate destination", "[vital]") {
  // The cutoff is an audio-rate control, so its modulation goes through a different destination than `mix`.
  // A low pass fed DC settles at a rate set by its cutoff, so the first few blocks after a fresh start show
  // whether the modulation reached it: unmodulated (~1 kHz) it is nearly there, modulated down it is not.
  auto settleEnergy = [](bool modulated) {
    Rig rig;
    REQUIRE(rig.engine.model().addNode(rig.reg, {"src", "test.const", {{"value", 0.5f}}}));
    REQUIRE(rig.engine.model().addNode(rig.reg, {"f", "filter.multi", {{"model", 3.f}, {"cutoff", 83.f}}}));
    REQUIRE(rig.engine.model().addNode(rig.reg, {"s", "test.sink", {}}));
    REQUIRE(rig.engine.model().addEdge(rig.reg, {"e1", "src", "out", "f", "in"}));
    REQUIRE(rig.engine.model().addEdge(rig.reg, {"e2", "f", "out", "s", "in"}));
    if (modulated) {
      REQUIRE(rig.engine.model().addNode(rig.reg, {"mod", "test.const", {{"value", -0.6f}}}));
      REQUIRE(rig.engine.model().addEdge(rig.reg, {"e3", "mod", "out", "f", "param:cutoff"}));
    }
    REQUIRE(rig.engine.commit());
    return rig.rmsAfterSettle(0, 4);
  };
  const float open = settleEnergy(false), closed = settleEnergy(true);
  REQUIRE(open > 0.3f);
  REQUIRE(closed < open * 0.6f);
}

TEST_CASE("filter.multi steady state is allocation free", "[vital][rt]") {
  Rig rig;
  REQUIRE(rig.engine.model().addNode(rig.reg, {"src", "test.const", {{"value", 0.5f}}}));
  REQUIRE(rig.engine.model().addNode(rig.reg, {"g", "test.impulse", {}}));
  REQUIRE(rig.engine.model().addNode(rig.reg, {"f", "filter.multi", {{"model", 3.f}, {"cutoff", 83.f}}}));
  REQUIRE(rig.engine.model().addNode(rig.reg, {"s", "test.sink", {}}));
  REQUIRE(rig.engine.model().addEdge(rig.reg, {"e1", "src", "out", "f", "in"}));
  REQUIRE(rig.engine.model().addEdge(rig.reg, {"e2", "g", "out", "f", "reset"}));
  REQUIRE(rig.engine.model().addEdge(rig.reg, {"e3", "src", "out", "f", "param:cutoff"}));
  REQUIRE(rig.engine.model().addEdge(rig.reg, {"e4", "f", "out", "s", "in"}));
  REQUIRE(rig.engine.commit());
  for (int i = 0; i < 8; ++i) rig.engine.renderBlock(rig.out, 2, 64, rig.t);
  pg::test::resetRtViolations();
  { pg::test::RtScope scope; for (int i = 0; i < 200; ++i) rig.engine.renderBlock(rig.out, 2, 64, rig.t); }
  REQUIRE(pg::test::rtViolations() == 0);
}

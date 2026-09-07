#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <map>
#include <memory>
#include <string>
#include "modules/builtin.hpp"
#include "util/GraphFixture.hpp"
#include "util/RtGuard.hpp"

namespace {

/// gate -> env.dahdsr, read straight off the envelope's own output buffer. The gate is an edge between two
/// constant nodes so it can be dropped later: swapping the edge and recompiling keeps the same envelope
/// instance (nothing structural changed), which is what makes the release observable.
struct Rig {
  pg::test::GraphFixture f;
  std::unique_ptr<pg::Program> program;

  explicit Rig(std::map<std::string, float> envParams) {
    pg::registerBuiltinModules(f.reg);
    f.node("hi", "test.const", {{"value", 1.f}});
    f.node("lo", "test.const", {{"value", 0.f}});
    f.node("env", "env.dahdsr", std::move(envParams));
    f.edge("gate", "hi.out", "env.gate");
    program = f.compile();
  }
  void run(int blocks = 1) { for (int i = 0; i < blocks; ++i) f.run(*program, 64); }
  void releaseGate() {
    REQUIRE(f.model.removeEdge("gate"));
    f.edge("gate", "lo.out", "env.gate");
    program = f.compile();
  }
  float out(uint32_t frame) { return f.out(*program, "env", "out", frame); }
  float phase(uint32_t frame) { return f.out(*program, "env", "phase", frame); }
};

const std::map<std::string, float> kInstant = {
  {"delay", 0.f}, {"attack", 0.f}, {"hold", 0.f}, {"decay", 0.f}, {"sustain", 1.f}, {"release", 0.f}};

}  // namespace

TEST_CASE("env.dahdsr descriptor is generated from the vendored parameter table", "[vital]") {
  pg::Registry reg;
  pg::registerBuiltinModules(reg);
  const pg::RegisteredModule* e = reg.find("env.dahdsr");
  REQUIRE(e != nullptr);
  REQUIRE(e->findInput("gate") == 0);
  REQUIRE(e->findOutput("out") == 0);
  REQUIRE(e->findOutput("phase") == 1);

  for (const char* id : {"delay", "attack", "hold", "decay", "sustain", "release",
                         "attack_power", "decay_power", "release_power"})
    REQUIRE(e->findParam(id) >= 0);
  REQUIRE(e->desc->numParams == 9);

  const int32_t attack = e->findParam("attack");
  REQUIRE(e->desc->params[attack].min == Catch::Approx(0.f));
  REQUIRE(e->desc->params[attack].max == Catch::Approx(2.37842f));
  REQUIRE(e->desc->params[attack].unit == pg::ParamUnit::Seconds);
  REQUIRE((e->desc->params[attack].flags & pg::kParamModulatable) != 0);
  REQUIRE(e->findInput("param:attack") >= 0);

  // The stage powers are plain controls with no modulation destination behind them.
  const int32_t power = e->findParam("attack_power");
  REQUIRE((e->desc->params[power].flags & pg::kParamModulatable) == 0);
  REQUIRE(e->desc->params[power].min == Catch::Approx(-20.f));

  for (uint32_t i = 0; i < e->desc->numParams; ++i)
    REQUIRE(std::string(e->desc->params[i].id).find("env_1") == std::string::npos);
}

TEST_CASE("env.dahdsr rises on the gate and releases when it drops", "[vital]") {
  Rig rig(kInstant);
  rig.run();
  REQUIRE(rig.out(63) == Catch::Approx(1.f).margin(0.02f));
  REQUIRE(rig.phase(63) > 0.f);

  rig.releaseGate();
  rig.run();
  REQUIRE(rig.out(63) == Catch::Approx(0.f).margin(0.02f));
}

TEST_CASE("env.dahdsr honours the attack and sustain knobs", "[vital]") {
  // Same graph, different knobs: if the params never reached the vendored envelope both would look identical.
  Rig fast(kInstant);
  fast.run();
  REQUIRE(fast.out(63) > 0.9f);

  std::map<std::string, float> slow = kInstant;
  slow["attack"] = 1.f;   // quartic: one second, so 64 frames in it has barely started
  Rig slowRig(slow);
  slowRig.run();
  REQUIRE(slowRig.out(63) < 0.2f);
  REQUIRE(slowRig.out(63) > slowRig.out(0));

  std::map<std::string, float> half = kInstant;
  half["sustain"] = 0.5f;
  Rig halfRig(half);
  halfRig.run();
  REQUIRE(halfRig.out(63) == Catch::Approx(0.5f).margin(0.02f));
}

TEST_CASE("env.dahdsr steady state is allocation free", "[vital][rt]") {
  std::map<std::string, float> params = kInstant;
  params["attack"] = 0.5f;
  params["release"] = 0.5f;
  Rig rig(params);
  rig.run(4);
  REQUIRE(rig.out(63) > 0.01f);   // it really is running, so the check below is not measuring a dead graph
  pg::test::resetRtViolations();
  { pg::test::RtScope scope; rig.run(200); }
  REQUIRE(pg::test::rtViolations() == 0);
}

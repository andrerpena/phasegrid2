#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <nlohmann/json.hpp>
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

/// A gate that is high on voice pair 0 and low on every other pair. Its input is only there to put it
/// inside an instrument, so that it runs once per live pair.
struct PairGate : pg::VoicedModule<int> {
  void process(pg::ProcessContext& c) override {
    for (uint32_t i = 0; i < c.numFrames; ++i) c.out(0).data[i] = pg::Sample(c.voice == 0 ? 1.f : 0.f);
  }
};
const pg::PortDesc kPairGateIn[] = {{"in", "In", pg::PortKind::Continuous, 1, pg::SignalRole::Any, ""}};
const pg::PortDesc kPairGateOut[] = {{"out", "Out", pg::PortKind::Continuous, 1, pg::SignalRole::Gate, ""}};
const pg::ModuleDescriptor kPairGate{pg::kModuleAbiVersion, "test.pairGate", "PairGate", "test", "",
  kPairGateIn, 1, kPairGateOut, 1, nullptr, 0, 0, 0, [] () -> pg::Module* { return new PairGate(); }, nullptr, 0};

/// Captures the last frame of one input per voice pair, WHILE that pair runs: the buffers are shared, so
/// once a block is over only the last pair's values are still in them.
struct PairProbe : pg::VoicedModule<int> {
  static inline std::array<float, 16> last{};
  void process(pg::ProcessContext& c) override {
    last[c.voice] = pg::lanes::lane(c.in(0).readOr()[c.numFrames - 1], 0);
  }
};
const pg::PortDesc kPairProbeIn[] = {{"in", "In", pg::PortKind::Continuous, 1, pg::SignalRole::Cv, ""}};
const pg::ModuleDescriptor kPairProbe{pg::kModuleAbiVersion, "test.pairProbe", "PairProbe", "test", "",
  kPairProbeIn, 1, nullptr, 0, nullptr, 0, 0, 0, [] () -> pg::Module* { return new PairProbe(); }, nullptr, 0};

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
  REQUIRE(e->findParam("lifetime") == 0);   // the adapter's own toggle, ahead of the generated params
  REQUIRE(e->desc->numParams == 10);

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

TEST_CASE("a vendored module keeps one DSP state per voice pair", "[vital]") {
  // The scheduler runs the op list once per pair through the same Module, and a vendored SynthModule holds
  // the state of exactly one poly_float -- one pair. Sharing one between pairs puts pair 1's gate on pair
  // 0's envelope, so here pair 1's closed gate would release pair 0's envelope every block and it would
  // never get past the first block's worth of attack.
  pg::test::GraphFixture f;
  pg::registerBuiltinModules(f.reg);
  REQUIRE_FALSE(f.reg.add(kPairGate).has_value());
  REQUIRE_FALSE(f.reg.add(kPairProbe).has_value());
  PairProbe::last = {};
  // Four notes held on a four-voice instrument: two live pairs, so the envelope runs twice per block.
  f.node("pat", "notes.pattern", {{"legato", 1.f}});
  REQUIRE(f.model.setNodeData("pat", nlohmann::json{{"pattern", "[c3,e3,g3,bb3]"}}));
  f.node("poly", "note.toPoly", {{"voices", 4.f}});
  f.node("gate", "test.pairGate");
  f.node("env", "env.dahdsr",
         {{"delay", 0.f}, {"attack", 0.5f}, {"hold", 0.f}, {"decay", 0.f}, {"sustain", 1.f}, {"release", 0.f}});
  f.node("probe", "test.pairProbe");
  f.edge("n0", "pat.notes", "poly.notes");
  f.edge("n1", "poly.gate", "gate.in");
  f.edge("e0", "gate.out", "env.gate");
  f.edge("e1", "env.out", "probe.in");
  auto program = f.compile();

  f.run(*program, 64);
  const float early = PairProbe::last[0];
  REQUIRE(early > 0.f);                    // pair 0's envelope really did open, so what follows measures it
  for (int i = 0; i < 120; ++i) f.run(*program, 64);   // 163 ms, well past the 62 ms attack
  const float later = PairProbe::last[0];
  REQUIRE(later > early * 5.f);            // and it kept climbing across blocks rather than restarting
  REQUIRE(later > 0.5f);
  REQUIRE(PairProbe::last[1] == 0.f);      // pair 1's gate never went high, so its envelope never opened
}

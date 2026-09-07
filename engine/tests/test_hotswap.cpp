#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <vector>
#include "core/Engine.hpp"
#include "modules/TestModules.hpp"
#include "util/RtGuard.hpp"

namespace {
struct Rig {
  pg::Registry reg;
  pg::Engine engine{reg, pg::EngineConfig{48000.0, 64}};
  pg::TransportSnapshot t;
  std::vector<float> l = std::vector<float>(64), r = std::vector<float>(64);
  float* out[2] = {l.data(), r.data()};
  Rig() { pg::test::registerTestModules(reg); }
  void render() { engine.renderBlock(out, 2, 64, t); }
  void add(const std::string& id, const std::string& type, std::map<std::string, float> p = {}) {
    REQUIRE(engine.model().addNode(reg, pg::NodeModel{id, type, std::move(p)}));
  }
  void edge(const std::string& id, const std::string& fn, const std::string& fp, const std::string& tn, const std::string& tp) {
    REQUIRE(engine.model().addEdge(reg, pg::EdgeModel{id, fn, fp, tn, tp}));
  }
};
}  // namespace

TEST_CASE("engine renders silence before any commit and audio after; only active voices reach the output", "[engine]") {
  Rig rig;
  rig.render();
  REQUIRE(rig.l[0] == 0.f);
  rig.add("c", "test.const", {{"value", 0.5f}});
  rig.add("s", "test.sink");
  rig.edge("e", "c", "out", "s", "in");
  REQUIRE(rig.engine.commit());
  rig.render();
  REQUIRE(rig.l[10] == Catch::Approx(0.5f));   // voice 0 only: voice 1 lanes are masked at voiceCount 1
  REQUIRE(rig.r[10] == Catch::Approx(0.5f));
  REQUIRE(rig.engine.model().setVoiceCount(2));
  REQUIRE(rig.engine.commit());
  rig.render();
  REQUIRE(rig.l[10] == Catch::Approx(1.0f));   // both voices carry the constant and are summed
}

TEST_CASE("engine hot-swap keeps DSP state continuous", "[engine]") {
  Rig rig;
  rig.add("add", "test.add"); rig.add("gain", "test.gain", {{"gain", 0.5f}}); rig.add("x", "test.impulse"); rig.add("s", "test.sink");
  rig.edge("e1", "x", "out", "add", "a"); rig.edge("e2", "add", "out", "gain", "in"); rig.edge("e3", "gain", "out", "add", "b");
  rig.edge("e4", "add", "out", "s", "in");
  REQUIRE(rig.engine.commit());
  rig.render();
  const float last = rig.l[63];
  REQUIRE(rig.l[0] == 1.f);
  rig.add("unrelated", "test.const");
  REQUIRE(rig.engine.commit());
  rig.render();
  REQUIRE(rig.l[0] == Catch::Approx(last * 0.5f));
  rig.engine.collectGarbage();
  REQUIRE(rig.engine.retiredCount() == 0);
}

TEST_CASE("engine param changes bypass the swap and are smoothed", "[engine]") {
  Rig rig;
  rig.add("c", "test.const", {{"value", 1.f}}); rig.add("g", "test.gain", {{"gain", 1.f}}); rig.add("s", "test.sink");
  rig.edge("e1", "c", "out", "g", "in"); rig.edge("e2", "g", "out", "s", "in");
  REQUIRE(rig.engine.commit());
  rig.render();
  REQUIRE(rig.l[0] == Catch::Approx(1.f));
  REQUIRE(rig.engine.setParam("g", "gain", 0.f));
  rig.render();
  REQUIRE(rig.l[0] < 1.f);
  REQUIRE(rig.l[63] < rig.l[0]);
  for (int i = 0; i < 40; ++i) rig.render();
  REQUIRE(rig.l[63] == Catch::Approx(0.f).margin(1e-4));
  REQUIRE(rig.engine.setParam("g", "nope", 0.f).code == "E_PARAM_NOT_FOUND");
}

TEST_CASE("engine commit failure keeps the old program", "[engine]") {
  Rig rig;
  rig.add("c", "test.const", {{"value", 0.5f}}); rig.add("s", "test.sink");
  rig.edge("e", "c", "out", "s", "in");
  REQUIRE(rig.engine.commit());
  const uint64_t rev = rig.engine.revision();
  rig.render();
  rig.add("tr", "test.eventTrace");
  for (uint32_t i = 0; i < pg::kMaxPortsPerModule + 1; ++i) {
    const std::string gid = "g" + std::to_string(i);
    rig.add(gid, "test.eventGen", {{"frame", 3.f}, {"tag", 1.f}});
    rig.edge("eg" + std::to_string(i), gid, "events", "tr", "events");
  }
  pg::Result r = rig.engine.commit();
  REQUIRE_FALSE(r);
  REQUIRE(r.code == "E_FAN_IN");
  REQUIRE(rig.engine.revision() == rev);
  REQUIRE(rig.engine.retiredCount() == 0);
  rig.render();
  REQUIRE(rig.l[0] == Catch::Approx(0.5f));
}

TEST_CASE("engine render path is allocation free, including the swap", "[engine][rt]") {
  Rig rig;
  rig.add("c", "test.const", {{"value", 0.5f}}); rig.add("s", "test.sink");
  rig.edge("e", "c", "out", "s", "in");
  REQUIRE(rig.engine.commit());
  rig.render();
  rig.add("g", "test.gain");
  REQUIRE(rig.engine.commit());
  REQUIRE(rig.engine.setParam("c", "value", 0.1f));
  pg::test::resetRtViolations();
  { pg::test::RtScope scope; for (int i = 0; i < 10; ++i) rig.render(); }
  REQUIRE(pg::test::rtViolations() == 0);
  rig.engine.collectGarbage();
}

TEST_CASE("engine renders interleaved for arbitrary device periods", "[engine]") {
  Rig rig;
  rig.add("c", "test.const", {{"value", 0.25f}}); rig.add("s", "test.sink");
  rig.edge("e", "c", "out", "s", "in");
  REQUIRE(rig.engine.commit());
  std::vector<float> buf(100 * 2);
  rig.engine.renderInterleaved(buf.data(), 100, 2, rig.t);
  rig.engine.renderInterleaved(buf.data(), 100, 2, rig.t);
  REQUIRE(buf[0] == Catch::Approx(0.25f));
  REQUIRE(buf[199] == Catch::Approx(0.25f));
}

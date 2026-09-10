#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <nlohmann/json.hpp>
#include <vector>
#include "core/Engine.hpp"
#include "modules/TestModules.hpp"
#include "util/RtGuard.hpp"

namespace {
struct Rig {
  pg::Registry reg;
  pg::Engine engine{reg, pg::EngineConfig{48000.0, 64}};
  pg::TransportSnapshot t;
  pg::Transport clock;   // for the interleaved entry point, which ticks the clock itself
  std::vector<float> l = std::vector<float>(64), r = std::vector<float>(64);
  float* out[2] = {l.data(), r.data()};
  Rig() { pg::test::registerTestModules(reg); clock.prepare(48000.0); }
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
  // A global signal lives in voice 0's lanes and reaches the output once; its mirrored half is masked.
  REQUIRE(rig.l[10] == Catch::Approx(0.5f));
  REQUIRE(rig.r[10] == Catch::Approx(0.5f));
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

TEST_CASE("a rebuilt instance takes over from the one it replaced, at the swap", "[engine][rt]") {
  // Node data is structural, so an edit to it builds a NEW instance. What the old one was in the middle
  // of -- for a note source, the notes it has started -- must reach the new one, or it is lost with the
  // old program: the swap hands each replaced instance the retiring one to `adopt` from.
  Rig rig;
  rig.add("n", "test.blockCount"); rig.add("s", "test.sink");
  rig.edge("e", "n", "out", "s", "in");
  REQUIRE(rig.engine.commit());
  for (int i = 0; i < 3; ++i) rig.render();
  REQUIRE(rig.l[0] == 3.f);

  REQUIRE(rig.engine.model().setNodeData("n", nlohmann::json{{"edit", 1}}));
  REQUIRE(rig.engine.commit());
  pg::test::resetRtViolations();
  { pg::test::RtScope scope; rig.render(); }
  REQUIRE(pg::test::rtViolations() == 0);   // the hand-over is audio-thread work
  REQUIRE(rig.l[0] == 4.f);                 // a fresh instance would say 1

  // Two edits before one swap: the instance the second edit replaced never ran, so the one that did is
  // what the survivor takes over from.
  REQUIRE(rig.engine.model().setNodeData("n", nlohmann::json{{"edit", 2}}));
  REQUIRE(rig.engine.commit());
  REQUIRE(rig.engine.model().setNodeData("n", nlohmann::json{{"edit", 3}}));
  REQUIRE(rig.engine.commit());
  rig.render();
  REQUIRE(rig.l[0] == 5.f);

  // An instance the compile reused is not handed itself.
  rig.add("unrelated", "test.const");
  REQUIRE(rig.engine.commit());
  rig.render();
  REQUIRE(rig.l[0] == 6.f);
  rig.engine.collectGarbage();
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
  rig.engine.renderInterleaved(buf.data(), 100, 2, rig.clock);
  rig.engine.renderInterleaved(buf.data(), 100, 2, rig.clock);
  REQUIRE(buf[0] == Catch::Approx(0.25f));
  REQUIRE(buf[199] == Catch::Approx(0.25f));
}

TEST_CASE("a model param change is heard after a commit, on an instance the compile reused", "[engine]") {
  // The batch route: `patch.batch` and `patch.load` write the model and commit, and never call
  // `Engine::setParam`. The instance survives the compile with the values it was created with, so
  // without a reconcile the model is ahead of the engine and a knob turned this way does nothing.
  Rig rig;
  rig.add("c", "test.const", {{"value", 1.f}}); rig.add("g", "test.gain", {{"gain", 1.f}}); rig.add("s", "test.sink");
  rig.edge("e1", "c", "out", "g", "in"); rig.edge("e2", "g", "out", "s", "in");
  REQUIRE(rig.engine.commit());
  rig.render();
  REQUIRE(rig.l[0] == Catch::Approx(1.f));

  REQUIRE(rig.engine.model().setParam(rig.reg, "g", "gain", 0.f));
  REQUIRE(rig.engine.commit());
  for (int i = 0; i < 40; ++i) rig.render();
  REQUIRE(rig.l[63] == Catch::Approx(0.f).margin(1e-4));
}

TEST_CASE("loading a patch over a live one applies its values to nodes that kept their id", "[engine]") {
  // Two example projects both call their oscillator "osc". Opening the second replaces the model
  // wholesale; the instance is reused because (id, type) match, and must take the new project's value.
  Rig rig;
  rig.add("c", "test.const", {{"value", 0.5f}}); rig.add("s", "test.sink");
  rig.edge("e", "c", "out", "s", "in");
  REQUIRE(rig.engine.commit());
  rig.render();
  REQUIRE(rig.l[0] == Catch::Approx(0.5f));

  rig.engine.model().clear();
  rig.add("c", "test.const", {{"value", 0.25f}}); rig.add("s", "test.sink");
  rig.edge("e", "c", "out", "s", "in");
  REQUIRE(rig.engine.commit());
  for (int i = 0; i < 40; ++i) rig.render();
  REQUIRE(rig.l[63] == Catch::Approx(0.25f).margin(1e-4));
}

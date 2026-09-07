#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include "util/GraphFixture.hpp"

using pg::test::GraphFixture;

TEST_CASE("compile: chain const -> gain", "[compiler]") {
  GraphFixture f;
  f.node("c", "test.const", {{"value", 0.5f}});
  f.node("g", "test.gain", {{"gain", 0.5f}});
  f.edge("e", "c.out", "g.in");
  auto p = f.compile();
  f.run(*p, 64);
  REQUIRE(f.out(*p, "g", "out", 63) == Catch::Approx(0.25f));
  REQUIRE(f.out(*p, "g", "out", 63, 3) == Catch::Approx(0.25f));
  REQUIRE(p->voicePairs == 1);
  REQUIRE(pg::lanes::lane(pg::Sample(1.f) & p->activeVoiceMask[0], 0) == 1.f);
  REQUIRE(pg::lanes::lane(pg::Sample(1.f) & p->activeVoiceMask[0], 2) == 0.f);   // voice 1 inactive at voiceCount 1
}

TEST_CASE("compile: fan-in sums, unconnected inputs are silent", "[compiler]") {
  GraphFixture f;
  f.node("a", "test.const", {{"value", 0.25f}});
  f.node("b", "test.const", {{"value", 0.5f}});
  f.node("g", "test.gain");
  f.node("lonely", "test.gain");
  f.edge("e1", "a.out", "g.in");
  f.edge("e2", "b.out", "g.in");
  auto p = f.compile();
  f.run(*p, 64);
  REQUIRE(f.out(*p, "g", "out", 0) == Catch::Approx(0.75f));
  REQUIRE(f.out(*p, "lonely", "out", 0) == 0.f);
}

TEST_CASE("compile: implicit param port modulates the knob", "[compiler]") {
  GraphFixture f;
  f.node("in", "test.const", {{"value", 1.f}});
  f.node("mod", "test.const", {{"value", 0.2f}});
  f.node("g", "test.gain", {{"gain", 0.5f}});
  f.edge("e1", "in.out", "g.in");
  f.edge("e2", "mod.out", "g.param:gain");
  auto p = f.compile();
  f.run(*p, 64);
  REQUIRE(f.out(*p, "g", "out", 10) == Catch::Approx(0.9f));   // norm 0.25 + 0.2 -> 0.9
}

TEST_CASE("compile: event ports merge by frame", "[compiler]") {
  GraphFixture f;
  f.node("e1", "test.eventGen", {{"frame", 3.f}, {"tag", 2.f}});
  f.node("e2", "test.eventGen", {{"frame", 3.f}, {"tag", 5.f}});
  f.node("t", "test.eventTrace");
  f.edge("x", "e1.events", "t.events");
  f.edge("y", "e2.events", "t.events");
  auto p = f.compile();
  f.run(*p, 64);
  REQUIRE(f.out(*p, "t", "out", 3) == Catch::Approx(7.f));
}

TEST_CASE("compile: topological order is respected regardless of id order", "[compiler]") {
  GraphFixture f;
  f.node("z_source", "test.const", {{"value", 0.5f}});
  f.node("a_sink", "test.gain");
  f.edge("e", "z_source.out", "a_sink.in");
  auto p = f.compile();
  f.run(*p, 64);
  REQUIRE(f.out(*p, "a_sink", "out", 0) == Catch::Approx(0.5f));
}

TEST_CASE("compile: reuses instances across compiles; voice pairs from voiceCount", "[compiler]") {
  GraphFixture f;
  f.node("c", "test.const", {{"value", 0.5f}});
  auto p1 = f.compile();
  f.node("g", "test.gain");
  f.model.setVoiceCount(3);
  auto p2 = f.compile();
  REQUIRE(p1->nodes[0].inst.get() == p2->nodes[0].inst.get());
  REQUIRE(f.table.size() == 2);
  REQUIRE(p2->voicePairs == 2);
  REQUIRE(pg::lanes::lane(pg::Sample(1.f) & p2->activeVoiceMask[1], 0) == 1.f);   // voice 2 active
  REQUIRE(pg::lanes::lane(pg::Sample(1.f) & p2->activeVoiceMask[1], 2) == 0.f);   // voice 3 does not exist
}

TEST_CASE("compile: rejects fan-in above kMaxPortsPerModule", "[compiler]") {
  GraphFixture f;
  f.node("t", "test.eventTrace");
  for (uint32_t i = 0; i < pg::kMaxPortsPerModule + 1; ++i) {
    f.node("g" + std::to_string(i), "test.eventGen", {{"frame", 3.f}, {"tag", 1.f}});
    f.edge("e" + std::to_string(i), "g" + std::to_string(i) + ".events", "t.events");
  }
  pg::CompileOutput o = pg::compileGraph(f.model, f.reg, f.table, 1, 48000.0, 64);
  REQUIRE(o.program == nullptr);
  REQUIRE(o.error.find("E_FAN_IN") != std::string::npos);
}

TEST_CASE("compile: exactly kMaxPortsPerModule fan-in still compiles", "[compiler]") {
  GraphFixture f;
  f.node("t", "test.eventTrace");
  for (uint32_t i = 0; i < pg::kMaxPortsPerModule; ++i) {
    f.node("g" + std::to_string(i), "test.eventGen", {{"frame", 3.f}, {"tag", 1.f}});
    f.edge("e" + std::to_string(i), "g" + std::to_string(i) + ".events", "t.events");
  }
  auto p = f.compile();
  f.run(*p, 64);
  REQUIRE(f.out(*p, "t", "out", 3) == Catch::Approx(static_cast<float>(pg::kMaxPortsPerModule)));
}

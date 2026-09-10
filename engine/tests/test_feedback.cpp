#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <cmath>
#include <nlohmann/json.hpp>
#include <stdexcept>
#include "modules/builtin.hpp"
#include "util/GraphFixture.hpp"
#include "util/RtGuard.hpp"

using pg::test::GraphFixture;

// y[n] = x[n] + 0.5 * y[n-1] with x = impulse -> 1, 0.5, 0.25, ...
static void buildIir(GraphFixture& f) {
  f.node("add", "test.add");
  f.node("gain", "test.gain", {{"gain", 0.5f}});
  f.node("x", "test.impulse");
  f.edge("e_in", "x.out", "add.a");
  f.edge("e_fwd", "add.out", "gain.in");
  f.edge("e_back", "gain.out", "add.b");
}

TEST_CASE("feedback: per-sample cluster has exactly one sample of delay", "[feedback]") {
  GraphFixture f; buildIir(f);
  auto p = f.compile();
  f.run(*p, 64);
  REQUIRE(f.out(*p, "add", "out", 0) == 1.f);
  REQUIRE(f.out(*p, "add", "out", 1) == 0.5f);
  REQUIRE(f.out(*p, "add", "out", 2) == 0.25f);
  REQUIRE(f.out(*p, "add", "out", 2, 3) == 0.25f);   // every lane
  REQUIRE(f.out(*p, "add", "out", 10) == Catch::Approx(std::pow(0.5, 10)));
  const float last = f.out(*p, "add", "out", 63);
  f.run(*p, 64);
  REQUIRE(f.out(*p, "add", "out", 0) == Catch::Approx(last * 0.5f));
}

TEST_CASE("feedback: block mode delays by one block", "[feedback]") {
  GraphFixture f; buildIir(f);
  f.model.feedbackMode = pg::FeedbackMode::Block;
  auto p = f.compile();
  f.run(*p, 64);
  REQUIRE(f.out(*p, "add", "out", 0) == 1.f);
  REQUIRE(f.out(*p, "add", "out", 1) == 0.f);
  f.run(*p, 64);
  REQUIRE(f.out(*p, "add", "out", 0) == 0.5f);
  REQUIRE(f.out(*p, "add", "out", 1) == 0.f);
}

TEST_CASE("feedback: self loop", "[feedback]") {
  GraphFixture f;
  f.node("g", "test.gain", {{"gain", 0.5f}});
  f.node("x", "test.impulse");
  f.edge("e_in", "x.out", "g.in");
  f.edge("e_self", "g.out", "g.in");
  auto p = f.compile();
  f.run(*p, 64);
  REQUIRE(f.out(*p, "g", "out", 0) == 0.5f);     // y[n] = 0.5 (x[n] + y[n-1])
  REQUIRE(f.out(*p, "g", "out", 1) == 0.25f);
  REQUIRE(f.out(*p, "g", "out", 2) == 0.125f);
}

TEST_CASE("feedback: FeedbackState survives recompiles", "[feedback]") {
  GraphFixture f; buildIir(f);
  auto p1 = f.compile();
  f.run(*p1, 64);
  const float last = f.out(*p1, "add", "out", 63);
  f.node("unrelated", "test.const");
  auto p2 = f.compile();
  f.run(*p2, 64);
  REQUIRE(f.out(*p2, "add", "out", 0) == Catch::Approx(last * 0.5f));
}

// y[n] = x[n] + y[n-1] with x a single impulse: a pure integrator, so anything that leaks from one
// voice pair into another is a permanent offset rather than something the loop decays away. The loop
// sits inside an instrument of `voices` voices, all of them held by a chord, so it runs once per pair:
// the gate reaches it through a gain of zero, which puts it in the instrument without changing its sum.
static void buildIntegrator(GraphFixture& f, uint32_t voices) {
  pg::registerBuiltinModules(f.reg);
  f.node("pat", "notes.pattern", {{"legato", 1.f}});
  if (!f.model.setNodeData("pat", nlohmann::json{{"pattern", "[c3,e3,g3,bb3,d4,f4,a4,c5]"}})) throw std::runtime_error("data");
  f.node("poly", "note.toPoly", {{"voices", static_cast<float>(voices)}});
  f.node("zero", "test.gain", {{"gain", 0.f}});
  f.node("add", "test.add");
  f.node("hold", "test.gain", {{"gain", 1.f}});
  f.node("x", "test.impulse");
  f.edge("n0", "pat.notes", "poly.notes");
  f.edge("n1", "poly.gate", "zero.in");
  f.edge("n2", "zero.out", "add.a");
  f.edge("e_in", "x.out", "add.a");
  f.edge("e_fwd", "add.out", "hold.in");
  f.edge("e_back", "hold.out", "add.b");
}

static uint32_t pairsOf(const pg::Program& p) {
  return p.instruments.empty() ? 1u : p.instruments[0].pairs;
}

TEST_CASE("feedback: each voice pair has its own delay memory", "[feedback]") {
  // One FeedbackState per edge means pair 0 writes the delay slot and pair 1 reads it, so voice 2's
  // loop starts from voice 0's tail. Buffers are shared between pairs, so what a block leaves behind
  // is the LAST pair's answer -- and that has to be the same answer the loop gives on its own.
  GraphFixture one; buildIntegrator(one, 2);
  auto p1 = one.compile();
  one.run(*p1, 64);
  REQUIRE(pairsOf(*p1) == 1);
  REQUIRE(one.out(*p1, "add", "out", 0) == 1.f);    // the impulse, then held
  REQUIRE(one.out(*p1, "add", "out", 63) == 1.f);

  GraphFixture two; buildIntegrator(two, 4);
  auto p2 = two.compile();
  two.run(*p2, 64);
  REQUIRE(pairsOf(*p2) == 2);
  for (uint32_t i : {0u, 1u, 31u, 63u})
    for (uint32_t lane : {0u, 1u, 2u, 3u})
      REQUIRE(two.out(*p2, "add", "out", i, lane) == one.out(*p1, "add", "out", i, lane));

  // Same again across a block boundary: the second block must not inherit the other pair's tail either.
  one.run(*p1, 64);
  two.run(*p2, 64);
  REQUIRE(two.out(*p2, "add", "out", 0) == one.out(*p1, "add", "out", 0));
  REQUIRE(two.out(*p2, "add", "out", 63) == one.out(*p1, "add", "out", 63));
}

TEST_CASE("feedback: each voice pair has its own delay memory in block mode", "[feedback]") {
  GraphFixture one; buildIntegrator(one, 2);
  one.model.feedbackMode = pg::FeedbackMode::Block;
  auto p1 = one.compile();

  GraphFixture two; buildIntegrator(two, 4);
  two.model.feedbackMode = pg::FeedbackMode::Block;
  auto p2 = two.compile();

  for (int block = 0; block < 3; ++block) {
    one.run(*p1, 64);
    two.run(*p2, 64);
    for (uint32_t i : {0u, 1u, 63u})
      REQUIRE(two.out(*p2, "add", "out", i) == one.out(*p1, "add", "out", i));
  }
}

TEST_CASE("feedback: scheduler run is allocation free", "[feedback][rt]") {
  GraphFixture f; buildIir(f);
  auto p = f.compile();
  pg::test::resetRtViolations();
  { pg::test::RtScope scope; for (int i = 0; i < 20; ++i) f.run(*p, 64); }
  REQUIRE(pg::test::rtViolations() == 0);
}

TEST_CASE("feedback: scheduler run is allocation free across several voice pairs", "[feedback][rt]") {
  // Per-pair delay memory is a vector sized on the message thread; indexing it must not touch the heap.
  GraphFixture f; buildIntegrator(f, 8);
  auto p = f.compile();
  REQUIRE(pairsOf(*p) == 4);
  pg::test::resetRtViolations();
  { pg::test::RtScope scope; for (int i = 0; i < 20; ++i) f.run(*p, 64); }
  REQUIRE(pg::test::rtViolations() == 0);
}

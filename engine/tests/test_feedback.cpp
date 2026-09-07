#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <cmath>
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

TEST_CASE("feedback: scheduler run is allocation free", "[feedback][rt]") {
  GraphFixture f; buildIir(f);
  auto p = f.compile();
  pg::test::resetRtViolations();
  { pg::test::RtScope scope; for (int i = 0; i < 20; ++i) f.run(*p, 64); }
  REQUIRE(pg::test::rtViolations() == 0);
}

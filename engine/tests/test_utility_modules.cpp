#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <cmath>
#include <cstdint>
#include "modules/builtin.hpp"
#include "util/GraphFixture.hpp"
#include "util/RtGuard.hpp"

TEST_CASE("math.scaleOffset and mix.mixer arithmetic", "[modules]") {
  pg::test::GraphFixture f;
  pg::registerBuiltinModules(f.reg);
  f.node("a", "test.const", {{"value", 0.25f}});
  f.node("b", "test.const", {{"value", 0.5f}});
  f.node("so", "math.scaleOffset", {{"scale", 2.f}, {"offset", 0.1f}});
  f.node("mx", "mix.mixer", {{"level1", 1.f}, {"level2", 0.5f}});
  f.edge("e1", "a.out", "so.in");
  f.edge("e2", "so.out", "mx.in1");
  f.edge("e3", "b.out", "mx.in2");
  auto p = f.compile();
  f.run(*p, 64);
  REQUIRE(f.out(*p, "so", "out", 5) == Catch::Approx(0.6f));
  // in3 and in4 are unconnected, so their levels (1 by default) must add nothing.
  REQUIRE(f.out(*p, "mx", "out", 5) == Catch::Approx(0.6f + 0.25f));
}

TEST_CASE("math.scaleOffset inverts on a negative scale", "[modules]") {
  pg::test::GraphFixture f;
  pg::registerBuiltinModules(f.reg);
  f.node("a", "test.const", {{"value", 0.5f}});
  f.node("so", "math.scaleOffset", {{"scale", -1.f}, {"offset", 0.25f}});
  f.edge("e", "a.out", "so.in");
  auto p = f.compile();
  f.run(*p, 64);
  REQUIRE(f.out(*p, "so", "out", 5) == Catch::Approx(-0.25f));
}

TEST_CASE("amp.vca multiplies by gain signal plus knob", "[modules]") {
  pg::test::GraphFixture f;
  pg::registerBuiltinModules(f.reg);
  f.node("a", "test.const", {{"value", 0.5f}});
  f.node("g", "test.const", {{"value", 0.5f}});
  f.node("vca", "amp.vca", {{"gain", 0.f}, {"curve", 0.f}});
  f.edge("e1", "a.out", "vca.in");
  f.edge("e2", "g.out", "vca.gain");
  auto p = f.compile();
  f.run(*p, 64);
  REQUIRE(f.out(*p, "vca", "out", 0) == Catch::Approx(0.25f));
}

TEST_CASE("amp.vca squares the sum on the exponential curve and never opens below zero", "[modules]") {
  auto outAt = [](float knob, float control, float curve) {
    pg::test::GraphFixture f;
    pg::registerBuiltinModules(f.reg);
    f.node("a", "test.const", {{"value", 1.f}});
    f.node("g", "test.const", {{"value", control}});
    f.node("vca", "amp.vca", {{"gain", knob}, {"curve", curve}});
    f.edge("e1", "a.out", "vca.in");
    f.edge("e2", "g.out", "vca.gain");
    auto p = f.compile();
    f.run(*p, 64);
    return f.out(*p, "vca", "out", 32);
  };
  REQUIRE(outAt(0.5f, 0.25f, 0.f) == Catch::Approx(0.75f));    // linear: the sum itself
  REQUIRE(outAt(0.5f, 0.25f, 1.f) == Catch::Approx(0.5625f));  // exponential: the sum squared
  // A control that swings past zero closes the amplifier rather than inverting the signal, and on the
  // exponential curve squaring a negative sum would otherwise fold it back open.
  REQUIRE(outAt(0.25f, -1.f, 0.f) == Catch::Approx(0.f));
  REQUIRE(outAt(0.25f, -1.f, 1.f) == Catch::Approx(0.f));
}

TEST_CASE("phase.clock ramps with the transport and fires a trigger at each wrap", "[modules]") {
  pg::test::GraphFixture f;
  pg::registerBuiltinModules(f.reg);
  f.node("clk", "phase.clock", {{"division", 2.f}});   // 1/4 note
  auto p = f.compile();
  f.transport.playing = true;
  f.transport.tempo = 120.0;                            // one quarter = 0.5 s = 24000 samples
  float lastPhase = -1.f;
  int triggers = 0;
  for (int b = 0; b < 750; ++b) {                       // 48000 samples = 2 quarters
    f.transport.ppq = (b * 64) / 24000.0;
    f.transport.samplePos = static_cast<uint64_t>(b) * 64;
    f.run(*p, 64);
    for (uint32_t i = 0; i < 64; ++i) {
      const float ph = f.out(*p, "clk", "phase", i);
      REQUIRE(ph >= 0.f);
      REQUIRE(ph < 1.f);
      if (f.out(*p, "clk", "trigger", i) > 0.f) ++triggers;
      lastPhase = ph;
    }
  }
  REQUIRE(triggers == 2);                               // the start of the run, and the second quarter
  REQUIRE(lastPhase == Catch::Approx(1.f).margin(0.01f));
}

TEST_CASE("phase.clock follows its division", "[modules]") {
  // Same two quarters of transport, one cycle per eighth instead of per quarter: twice as many wraps.
  auto trigsForDivision = [](float division) {
    pg::test::GraphFixture f;
    pg::registerBuiltinModules(f.reg);
    f.node("clk", "phase.clock", {{"division", division}});
    auto p = f.compile();
    f.transport.playing = true;
    f.transport.tempo = 120.0;
    int triggers = 0;
    for (int b = 0; b < 750; ++b) {
      f.transport.ppq = (b * 64) / 24000.0;
      f.run(*p, 64);
      for (uint32_t i = 0; i < 64; ++i)
        if (f.out(*p, "clk", "trigger", i) > 0.f) ++triggers;
    }
    return triggers;
  };
  REQUIRE(trigsForDivision(0.f) == 8);   // 1/16
  REQUIRE(trigsForDivision(1.f) == 4);   // 1/8
  REQUIRE(trigsForDivision(3.f) == 1);   // 1/2: only the one at the start of the run
}

TEST_CASE("phase.clock swing delays every second cycle", "[modules]") {
  // Where the second cycle of each pair starts, in samples from the start of the run. With no swing that
  // is one quarter in; swing pushes it later by that fraction of a cycle, and the pair still ends on time.
  auto secondWrapAt = [](float swing) {
    pg::test::GraphFixture f;
    pg::registerBuiltinModules(f.reg);
    f.node("clk", "phase.clock", {{"division", 2.f}, {"swing", swing}});
    auto p = f.compile();
    f.transport.playing = true;
    f.transport.tempo = 120.0;
    int wraps = 0;
    for (int b = 0; b < 750; ++b) {
      f.transport.ppq = (b * 64) / 24000.0;
      f.run(*p, 64);
      for (uint32_t i = 0; i < 64; ++i)
        if (f.out(*p, "clk", "trigger", i) > 0.f && ++wraps == 2) return b * 64 + static_cast<int>(i);
    }
    return -1;
  };
  REQUIRE(secondWrapAt(0.f) == 24000);
  REQUIRE(secondWrapAt(0.25f) == 30000);   // a quarter of a cycle later
  REQUIRE(secondWrapAt(0.5f) == 36000);
}

TEST_CASE("phase.clock free-runs while the transport is stopped", "[modules]") {
  pg::test::GraphFixture f;
  pg::registerBuiltinModules(f.reg);
  f.node("clk", "phase.clock", {{"division", 2.f}});
  auto p = f.compile();
  f.transport.playing = false;
  f.transport.tempo = 120.0;
  f.transport.ppq = 0.0;   // never advances: a clock that only read ppq would stand still
  int triggers = 0;
  for (int b = 0; b < 750; ++b) {
    f.transport.samplePos = static_cast<uint64_t>(b) * 64;
    f.run(*p, 64);
    for (uint32_t i = 0; i < 64; ++i)
      if (f.out(*p, "clk", "trigger", i) > 0.f) ++triggers;
  }
  REQUIRE(triggers == 2);
}

TEST_CASE("phase.clock never reports a phase of exactly 1", "[modules]") {
  // A musical position a hair under the end of a cycle is a double that rounds UP to 1 when narrowed to
  // float, and the phase output is documented as 0 <= phase < 1. The narrowing has to be caught, not
  // trusted: a sequencer indexing steps by `phase * steps` would run off the end of its pattern.
  pg::test::GraphFixture f;
  pg::registerBuiltinModules(f.reg);
  f.node("clk", "phase.clock", {{"division", 2.f}});
  auto p = f.compile();
  f.transport.playing = true;
  f.transport.tempo = 120.0;
  f.transport.ppq = 1.0 - 1e-9;
  f.run(*p, 1);
  REQUIRE(f.out(*p, "clk", "phase", 0) < 1.f);
  REQUIRE(f.out(*p, "clk", "phase", 0) > 0.99f);
}

TEST_CASE("the utility modules are allocation free", "[modules][rt]") {
  pg::test::GraphFixture f;
  pg::registerBuiltinModules(f.reg);
  f.node("a", "test.const", {{"value", 0.5f}});
  f.node("clk", "phase.clock", {{"division", 0.f}, {"swing", 0.2f}});
  f.node("so", "math.scaleOffset", {{"scale", 2.f}, {"offset", -0.5f}});
  f.node("mx", "mix.mixer");
  f.node("vca", "amp.vca", {{"gain", 0.f}, {"curve", 1.f}});
  f.edge("e1", "clk.phase", "so.in");
  f.edge("e2", "so.out", "mx.in1");
  f.edge("e3", "clk.trigger", "mx.in2");
  f.edge("e4", "mx.out", "vca.in");
  f.edge("e5", "a.out", "vca.gain");
  auto p = f.compile();
  f.transport.playing = true;
  f.transport.tempo = 120.0;
  float energy = 0.f;
  for (int b = 0; b < 8; ++b) {
    f.transport.ppq = (b * 64) / 24000.0;
    f.run(*p, 64);
    for (uint32_t i = 0; i < 64; ++i) energy += std::fabs(f.out(*p, "vca", "out", i));
  }
  REQUIRE(energy > 0.f);   // the chain really produces signal, so the check below is not measuring silence
  pg::test::resetRtViolations();
  { pg::test::RtScope scope; for (int b = 0; b < 200; ++b) f.run(*p, 64); }
  REQUIRE(pg::test::rtViolations() == 0);
}

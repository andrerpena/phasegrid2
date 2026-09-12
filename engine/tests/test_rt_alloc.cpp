#include <catch2/catch_test_macros.hpp>
#include <vector>
#include "app/Tone.hpp"
#include "core/Engine.hpp"
#include "services/BlockSplitter.hpp"
#include "util/RtGuard.hpp"

TEST_CASE("RtScope detects heap allocation", "[rt]") {
  pg::test::resetRtViolations();
  {
    pg::test::RtScope scope;
    std::vector<int> v(64, 1);
#if defined(__GNUC__) || defined(__clang__)
    asm volatile("" : : "r"(v.data()) : "memory");
#endif
    REQUIRE(v[3] == 1);
  }
  REQUIRE(pg::test::rtViolations() > 0);
}

TEST_CASE("tone + block splitter do not allocate on the render path", "[rt]") {
  pg::ToneGenerator tone; tone.prepare(48000.0, 440.0);
  pg::BlockSplitter splitter; splitter.prepare(64, 2);
  std::vector<float> out(100 * 2);
  pg::BlockSplitter::BlockFn block = [&](float* b, uint32_t n) { tone.render(b, n, 2); };
  pg::test::resetRtViolations();
  { pg::test::RtScope scope; for (int i = 0; i < 50; ++i) splitter.render(out.data(), 100, block); }
  REQUIRE(pg::test::rtViolations() == 0);
}

TEST_CASE("rendering leaves the thread flushing denormals to zero", "[rt][denormals]") {
  /*
   * The contract `Engine::renderInterleaved` owes whatever thread it is called on: no denormals. They
   * cost around a hundred cycles each on x86-64 and appear wherever audio decays towards silence rather
   * than stopping -- reverb tails, delay feedback, envelope releases -- so they arrive as a crackle
   * under load at the quietest moment, not as a wrong number. See rt/Denormals.hpp.
   *
   * Only the post-condition is asserted. The flag is per thread and sticky, so a test that ran earlier
   * in this process may already have set it, and "it was off before" is not a thing this can honestly
   * check. `volatile` keeps the compiler from folding the multiply at build time, where the host's own
   * rounding rules would apply instead of the target's.
   */
  pg::Registry reg;
  pg::Engine engine{reg, pg::EngineConfig{48000.0, 64}};
  pg::Transport clock;
  clock.prepare(48000.0);
  std::vector<float> out(64 * 2, 0.f);
  engine.renderInterleaved(out.data(), 64, 2, clock);

  volatile float smallest = 1.1754944e-38f;   // the smallest normal float
  volatile float denormal = smallest * 0.01f;   // denormal without flush-to-zero, exactly zero with it
  REQUIRE(denormal == 0.f);
}

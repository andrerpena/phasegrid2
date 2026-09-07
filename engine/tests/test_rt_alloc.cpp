#include <catch2/catch_test_macros.hpp>
#include <vector>
#include "app/Tone.hpp"
#include "services/BlockSplitter.hpp"
#include "util/RtGuard.hpp"

TEST_CASE("RtScope detects heap allocation", "[rt]") {
  pg::test::resetRtViolations();
  {
    pg::test::RtScope scope;
    std::vector<int> v(64, 1);
    asm volatile("" : : "r"(v.data()) : "memory");   // pointer escapes: the allocation cannot be elided
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

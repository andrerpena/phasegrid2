#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <cmath>
#include <vector>
#include "app/Tone.hpp"

TEST_CASE("ToneGenerator produces a sine at the requested frequency", "[tone]") {
  pg::ToneGenerator tone;
  tone.prepare(48000.0, 1000.0);   // 48 samples per cycle
  std::vector<float> buf(96 * 2);
  tone.render(buf.data(), 96, 2);
  REQUIRE(buf[0] == Catch::Approx(0.f).margin(1e-6));
  REQUIRE(buf[12 * 2] == Catch::Approx(tone.amp).margin(1e-4));       // quarter cycle
  REQUIRE(buf[48 * 2] == Catch::Approx(0.f).margin(1e-4));            // full cycle
  REQUIRE(buf[12 * 2 + 1] == buf[12 * 2]);                             // both channels
}

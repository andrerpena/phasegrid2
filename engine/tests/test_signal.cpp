#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include "core/Conventions.hpp"
#include "core/Signal.hpp"

TEST_CASE("pitch and gate conventions", "[core]") {
  REQUIRE(pg::pitchToHz(0.f) == Catch::Approx(261.6256f));
  REQUIRE(pg::pitchToHz(0.1f) == Catch::Approx(523.2512f).epsilon(1e-4));
  REQUIRE(pg::midiNoteToPitch(72.f) == Catch::Approx(0.1f));
  REQUIRE(pg::pitchToMidiNote(0.1f) == Catch::Approx(72.f));
  REQUIRE(pg::gateHigh(0.5f));
  REQUIRE_FALSE(pg::gateHigh(0.f));
  const pg::Sample notes = pg::pitchToMidiNote(pg::lanes::mono(0.1f));
  REQUIRE(pg::lanes::lane(notes, 0) == Catch::Approx(72.f));
  REQUIRE(pg::lanes::lane(notes, 3) == Catch::Approx(72.f));
}

TEST_CASE("lanes: layout is v0.L v0.R v1.L v1.R", "[core]") {
  const pg::Sample s = pg::lanes::stereo(0.25f, -0.5f);
  REQUIRE(pg::lanes::left(s, 0) == 0.25f);
  REQUIRE(pg::lanes::right(s, 0) == -0.5f);
  REQUIRE(pg::lanes::left(s, 1) == 0.25f);
  REQUIRE(pg::lanes::right(s, 1) == -0.5f);
  const pg::Sample onlyVoice0 = s & pg::lanes::voice(0);
  REQUIRE(pg::lanes::left(onlyVoice0, 0) == 0.25f);
  REQUIRE(pg::lanes::left(onlyVoice0, 1) == 0.f);
  const pg::Sample onlyLeft = s & pg::lanes::left();
  REQUIRE(pg::lanes::right(onlyLeft, 0) == 0.f);
  REQUIRE(pg::lanes::left(onlyLeft, 1) == 0.25f);
}

TEST_CASE("Block and SignalView slice and clear", "[core]") {
  pg::Block b;
  for (uint32_t i = 0; i < 8; ++i) b.data[i] = pg::lanes::mono(static_cast<float>(i));
  pg::SignalView v = b.view(8);
  REQUIRE(v.numFrames == 8);
  REQUIRE(pg::lanes::lane(v.data[3], 1) == 3.f);
  pg::SignalView s = v.slice(4, 2);
  REQUIRE(s.numFrames == 2);
  REQUIRE(pg::lanes::lane(s.data[0], 0) == 4.f);
  s.clear();
  REQUIRE(pg::lanes::lane(b.data[4], 0) == 0.f);
  REQUIRE(pg::lanes::lane(b.data[6], 0) == 6.f);
  pg::SignalView unconnected;
  REQUIRE(unconnected.empty());
  REQUIRE(pg::lanes::lane(unconnected.readOr()[5], 2) == 0.f);
  REQUIRE(v.readOr() == v.data);
  REQUIRE(reinterpret_cast<uintptr_t>(b.data.data()) % 16 == 0);
  static_assert(pg::kMaxBlockSize == vital::kMaxBufferSize);
}

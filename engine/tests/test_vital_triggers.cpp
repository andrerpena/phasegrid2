#include <catch2/catch_test_macros.hpp>
#include "vital/Triggers.hpp"

TEST_CASE("deriveTriggers emits kVoiceOn on rising and kVoiceOff on falling edges per lane", "[vital]") {
  pg::Sample gate[8];
  for (auto& g : gate) g = pg::Sample(0.f);
  gate[3] = pg::Sample(1.f, 1.f, 0.f, 0.f);   // voice 0 rises at frame 3
  gate[4] = gate[3];
  gate[5] = gate[3];
  gate[6] = pg::Sample(0.f, 0.f, 1.f, 1.f);   // voice 0 falls, voice 1 rises at frame 6
  gate[7] = gate[6];
  pg::Sample last(0.f);
  vital::Output out;
  pg::vendor::deriveTriggers(gate, 8, last, out);
  REQUIRE(out.trigger_mask.anyMask());
  REQUIRE(out.trigger_value[0] == static_cast<float>(vital::kVoiceOff));   // the last event on a lane wins
  REQUIRE(out.trigger_offset[0] == 6u);
  REQUIRE(out.trigger_value[2] == static_cast<float>(vital::kVoiceOn));
  REQUIRE(out.trigger_offset[2] == 6u);
  REQUIRE(pg::lanes::lane(last, 2) == 1.f);
  pg::vendor::deriveTriggers(gate + 7, 1, last, out);   // no edge in this block
  REQUIRE_FALSE(out.trigger_mask.anyMask());
}

TEST_CASE("deriveTriggers sees an edge that straddles a block boundary", "[vital]") {
  pg::Sample a[2] = {pg::Sample(0.f), pg::Sample(0.f)};
  pg::Sample b[2] = {pg::Sample(1.f), pg::Sample(1.f)};
  pg::Sample last(0.f);
  vital::Output out;
  pg::vendor::deriveTriggers(a, 2, last, out);
  REQUIRE_FALSE(out.trigger_mask.anyMask());
  pg::vendor::deriveTriggers(b, 2, last, out);       // rises on the first frame of the SECOND block
  REQUIRE(out.trigger_mask.anyMask());
  REQUIRE(out.trigger_value[0] == static_cast<float>(vital::kVoiceOn));
  REQUIRE(out.trigger_offset[0] == 0u);
  pg::vendor::deriveTriggers(b, 2, last, out);       // still high: no new edge
  REQUIRE_FALSE(out.trigger_mask.anyMask());
}

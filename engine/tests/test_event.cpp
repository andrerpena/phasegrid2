#include <catch2/catch_test_macros.hpp>
#include "core/Event.hpp"

TEST_CASE("EventBuffer keeps frame order and rejects overflow", "[core]") {
  pg::EventBuffer b;
  REQUIRE(b.push(pg::Event{.frame = 3}));
  REQUIRE(b.push(pg::Event{.frame = 3}));
  REQUIRE_FALSE(b.push(pg::Event{.frame = 2}));   // out of order
  REQUIRE(b.size() == 2);
  b.clear();
  for (uint32_t i = 0; i < pg::kMaxEventsPerBlock; ++i) REQUIRE(b.push(pg::Event{.frame = i}));
  REQUIRE_FALSE(b.push(pg::Event{.frame = 300}));
}

TEST_CASE("mergeEvents is a stable k-way merge by frame", "[core]") {
  pg::EventBuffer a, b, dst;
  a.push(pg::Event{.frame = 1, .a = 1.f}); a.push(pg::Event{.frame = 5, .a = 2.f});
  b.push(pg::Event{.frame = 0, .a = 3.f}); b.push(pg::Event{.frame = 5, .a = 4.f});
  const pg::EventBuffer* srcs[] = {&a, &b};
  pg::mergeEvents(srcs, 2, dst);
  REQUIRE(dst.size() == 4);
  REQUIRE(dst[0].a == 3.f);
  REQUIRE(dst[1].a == 1.f);
  REQUIRE(dst[2].a == 2.f);   // a before b on equal frame
  REQUIRE(dst[3].a == 4.f);
}

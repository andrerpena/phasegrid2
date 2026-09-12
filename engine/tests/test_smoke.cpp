#include <catch2/catch_test_macros.hpp>
#include "core/Version.hpp"

TEST_CASE("engine reports a version", "[smoke]") {
  REQUIRE(std::string(pg::engineVersion()) == "0.1.0");
}

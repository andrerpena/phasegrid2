#include <catch2/catch_test_macros.hpp>
#include "core/InstanceTable.hpp"
#include "modules/TestModules.hpp"

TEST_CASE("InstanceTable creates a fresh instance when PrepareInfo changes; the old instance stays alive via its shared_ptr", "[instance_table]") {
  pg::Registry reg; pg::test::registerTestModules(reg);
  pg::InstanceTable table;
  pg::PrepareInfo info1{48000.0, pg::kMaxBlockSize, 1};
  std::shared_ptr<pg::ModuleInstance> a1 = table.acquire("a", *reg.find("test.const"), info1, {});
  pg::PrepareInfo info2{48000.0, pg::kMaxBlockSize, 2};
  std::shared_ptr<pg::ModuleInstance> a2 = table.acquire("a", *reg.find("test.const"), info2, {});
  REQUIRE(a1.get() != a2.get());
  REQUIRE(a1->serial != a2->serial);
  REQUIRE(a1.use_count() > 0);
  REQUIRE(a1->module != nullptr);
}

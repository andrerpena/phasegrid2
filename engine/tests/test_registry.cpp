#include <catch2/catch_test_macros.hpp>
#include "core/Registry.hpp"
#include "modules/TestModules.hpp"

TEST_CASE("registry derives implicit modulation ports", "[registry]") {
  pg::Registry reg;
  pg::test::registerTestModules(reg);
  const pg::RegisteredModule* gain = reg.find("test.gain");
  REQUIRE(gain != nullptr);
  REQUIRE(gain->numDeclaredInputs() == 1);
  REQUIRE(gain->inputs.size() == 2);
  REQUIRE(gain->findInput("in") == 0);
  REQUIRE(gain->findInput("param:gain") == 1);
  REQUIRE(gain->inputParam[1] == 0);
  REQUIRE(gain->inputs[1].kind == pg::PortKind::Continuous);
  REQUIRE(gain->findOutput("out") == 0);
  REQUIRE(gain->findParam("gain") == 0);
  REQUIRE(gain->findInput("nope") == -1);
  REQUIRE(reg.find("test.eventGen")->inputs.empty());   // int params are not modulatable
}

TEST_CASE("registry rejects invalid descriptors", "[registry]") {
  pg::Registry reg;
  pg::test::registerTestModules(reg);
  static pg::ParamDesc badLog{"c", "C", 0.f, 10.f, 1.f, pg::ParamUnit::Hz, pg::ParamCurve::Log, 0, nullptr, 0, "slider", nullptr, "Bad log param"};
  static pg::ModuleDescriptor bad{pg::kModuleAbiVersion, "test.bad", "Bad", "test", "", nullptr, 0, nullptr, 0, &badLog, 1, 0, 0, nullptr};
  REQUIRE(reg.add(bad).has_value());
  static pg::ModuleDescriptor dup{pg::kModuleAbiVersion, "test.gain", "Dup", "test", "", nullptr, 0, nullptr, 0, nullptr, 0, 0, 0, nullptr};
  REQUIRE(reg.add(dup).has_value());
}

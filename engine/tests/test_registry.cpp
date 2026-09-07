#include <catch2/catch_test_macros.hpp>
#include <string>
#include "core/Conventions.hpp"
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

// A stepped (integer/enum) param never gets an implicit `param:<id>` port, so declaring an explicit
// input by that name is legal. The collision check used to look only at kParamModulatable and
// rejected it.
TEST_CASE("registry allows an explicit param: input for a stepped modulatable param", "[registry]") {
  pg::Registry reg;
  static const char* const kLabels[] = {"A", "B"};
  static pg::PortDesc modeInput[] = {{"param:mode", "Mode In", pg::PortKind::Continuous, 1, pg::SignalRole::Cv, ""}};
  static pg::ParamDesc modeParam{"mode", "Mode", 0.f, 1.f, 0.f, pg::ParamUnit::None, pg::ParamCurve::Linear,
                                 pg::kParamModulatable | pg::kParamEnum, kLabels, 2, "select", nullptr, ""};
  static pg::ModuleDescriptor modeDesc{pg::kModuleAbiVersion, "test.enumPort", "EnumPort", "test", "", modeInput, 1,
                                       nullptr, 0, &modeParam, 1, 0, 0, [] () -> pg::Module* { return nullptr; }};
  REQUIRE(!reg.add(modeDesc).has_value());
  const pg::RegisteredModule* m = reg.find("test.enumPort");
  REQUIRE(m != nullptr);
  REQUIRE(m->inputs.size() == 1);              // the declared port, and no implicit duplicate
  REQUIRE(m->findInput("param:mode") == 0);
  REQUIRE(m->inputParam[0] == -1);             // it is a plain input, not the implicit mod port
}

TEST_CASE("registry rejects invalid descriptors", "[registry]") {
  pg::Registry reg;
  pg::test::registerTestModules(reg);

  // Missing create function
  static pg::ModuleDescriptor noCreate{pg::kModuleAbiVersion, "test.noCreate", "NoCreate", "test", "", nullptr, 0, nullptr, 0, nullptr, 0, 0, 0, nullptr};
  REQUIRE(reg.add(noCreate).has_value());

  // Duplicate input ids
  static pg::PortDesc dupInputs[] = {{"in", "In", pg::PortKind::Continuous, 1, pg::SignalRole::Any, ""}, {"in", "In2", pg::PortKind::Continuous, 1, pg::SignalRole::Any, ""}};
  static pg::ModuleDescriptor dupInDesc{pg::kModuleAbiVersion, "test.dupIn", "DupIn", "test", "", dupInputs, 2, nullptr, 0, nullptr, 0, 0, 0, [] () -> pg::Module* { return nullptr; }};
  REQUIRE(reg.add(dupInDesc).has_value());

  // Duplicate output ids
  static pg::PortDesc dupOutputs[] = {{"out", "Out", pg::PortKind::Continuous, 1, pg::SignalRole::Any, ""}, {"out", "Out2", pg::PortKind::Continuous, 1, pg::SignalRole::Any, ""}};
  static pg::ModuleDescriptor dupOutDesc{pg::kModuleAbiVersion, "test.dupOut", "DupOut", "test", "", nullptr, 0, dupOutputs, 2, nullptr, 0, 0, 0, [] () -> pg::Module* { return nullptr; }};
  REQUIRE(reg.add(dupOutDesc).has_value());

  // Duplicate param ids
  static pg::ParamDesc dupParams[] = {
    {"p", "P1", 0.f, 1.f, 0.5f, pg::ParamUnit::None, pg::ParamCurve::Linear, 0, nullptr, 0, "slider", nullptr, ""},
    {"p", "P2", 0.f, 1.f, 0.5f, pg::ParamUnit::None, pg::ParamCurve::Linear, 0, nullptr, 0, "slider", nullptr, ""}
  };
  static pg::ModuleDescriptor dupParamDesc{pg::kModuleAbiVersion, "test.dupParam", "DupParam", "test", "", nullptr, 0, nullptr, 0, dupParams, 2, 0, 0, [] () -> pg::Module* { return nullptr; }};
  REQUIRE(reg.add(dupParamDesc).has_value());

  // min >= max
  static pg::ParamDesc badRange{"p", "P", 1.f, 1.f, 0.5f, pg::ParamUnit::None, pg::ParamCurve::Linear, 0, nullptr, 0, "slider", nullptr, ""};
  static pg::ModuleDescriptor badRangeDesc{pg::kModuleAbiVersion, "test.badRange", "BadRange", "test", "", nullptr, 0, nullptr, 0, &badRange, 1, 0, 0, [] () -> pg::Module* { return nullptr; }};
  REQUIRE(reg.add(badRangeDesc).has_value());

  // Log param with min <= 0
  static pg::ParamDesc badLog{"c", "C", 0.f, 10.f, 1.f, pg::ParamUnit::Hz, pg::ParamCurve::Log, 0, nullptr, 0, "slider", nullptr, ""};
  static pg::ModuleDescriptor badLogDesc{pg::kModuleAbiVersion, "test.badLog", "BadLog", "test", "", nullptr, 0, nullptr, 0, &badLog, 1, 0, 0, [] () -> pg::Module* { return nullptr; }};
  REQUIRE(reg.add(badLogDesc).has_value());

  // Enum param with no labels
  static pg::ParamDesc badEnum{"e", "E", 0.f, 2.f, 0.f, pg::ParamUnit::None, pg::ParamCurve::Linear, pg::kParamEnum, nullptr, 0, "select", nullptr, ""};
  static pg::ModuleDescriptor badEnumDesc{pg::kModuleAbiVersion, "test.badEnum", "BadEnum", "test", "", nullptr, 0, nullptr, 0, &badEnum, 1, 0, 0, [] () -> pg::Module* { return nullptr; }};
  REQUIRE(reg.add(badEnumDesc).has_value());

  // Structural param that is also modulatable: a structural value is read once while the instance is built,
  // so there is nowhere for a per-sample modulation signal to go.
  static pg::ParamDesc badStructural{"s", "S", 0.f, 1.f, 0.f, pg::ParamUnit::None, pg::ParamCurve::Linear, pg::kParamStructural | pg::kParamModulatable, nullptr, 0, "select", nullptr, ""};
  static pg::ModuleDescriptor badStructuralDesc{pg::kModuleAbiVersion, "test.badStructural", "BadStructural", "test", "", nullptr, 0, nullptr, 0, &badStructural, 1, 0, 0, [] () -> pg::Module* { return nullptr; }};
  REQUIRE(reg.add(badStructuralDesc).has_value());

  // Implicit port collision (modulatable param "gain" collides with declared input "param:gain")
  static pg::PortDesc collideInput[] = {{"param:gain", "Gain In", pg::PortKind::Continuous, 1, pg::SignalRole::Cv, ""}};
  static pg::ParamDesc collideParam{"gain", "Gain", 0.f, 1.f, 0.5f, pg::ParamUnit::None, pg::ParamCurve::Linear, pg::kParamModulatable, nullptr, 0, "slider", nullptr, ""};
  static pg::ModuleDescriptor collideDesc{pg::kModuleAbiVersion, "test.collide", "Collide", "test", "", collideInput, 1, nullptr, 0, &collideParam, 1, 0, 0, [] () -> pg::Module* { return nullptr; }};
  REQUIRE(reg.add(collideDesc).has_value());

  // Too many params
  static std::string paramIds[pg::kMaxParamsPerModule + 1];
  static pg::ParamDesc manyParams[pg::kMaxParamsPerModule + 1];
  for (uint32_t i = 0; i <= pg::kMaxParamsPerModule; ++i) {
    paramIds[i] = "p" + std::to_string(i);
    manyParams[i] = {paramIds[i].c_str(), "P", 0.f, 1.f, 0.5f, pg::ParamUnit::None, pg::ParamCurve::Linear, 0, nullptr, 0, "slider", nullptr, ""};
  }
  static pg::ModuleDescriptor tooManyDesc{pg::kModuleAbiVersion, "test.tooMany", "TooMany", "test", "", nullptr, 0, nullptr, 0, manyParams, pg::kMaxParamsPerModule + 1, 0, 0, [] () -> pg::Module* { return nullptr; }};
  REQUIRE(reg.add(tooManyDesc).has_value());

  // ABI version mismatch
  static pg::ModuleDescriptor abiMismatch{99, "test.abiMismatch", "ABIMismatch", "test", "", nullptr, 0, nullptr, 0, nullptr, 0, 0, 0, [] () -> pg::Module* { return nullptr; }};
  REQUIRE(reg.add(abiMismatch).has_value());

  // Verify one success case registers and is counted
  static pg::PortDesc okOut[] = {{"out", "Out", pg::PortKind::Continuous, 1, pg::SignalRole::Any, ""}};
  static pg::ModuleDescriptor ok{pg::kModuleAbiVersion, "test.ok", "Ok", "test", "", nullptr, 0, okOut, 1, nullptr, 0, 0, 0, [] () -> pg::Module* { return nullptr; }};
  REQUIRE(!reg.add(ok).has_value());
  const pg::RegisteredModule* okModule = reg.find("test.ok");
  REQUIRE(okModule != nullptr);
  REQUIRE(okModule->desc->id == std::string("test.ok"));
  // Verify all() includes the new module
  auto all = reg.all();
  bool foundOk = false;
  for (const auto* m : all) {
    if (m->desc->id == std::string("test.ok")) {
      foundOk = true;
      break;
    }
  }
  REQUIRE(foundOk);
}

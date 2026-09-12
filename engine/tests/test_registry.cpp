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
                                       nullptr, 0, &modeParam, 1, 0, 0, [] () -> pg::Module* { return nullptr; }, nullptr, 0};
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
  static pg::ModuleDescriptor noCreate{pg::kModuleAbiVersion, "test.noCreate", "NoCreate", "test", "", nullptr, 0, nullptr, 0, nullptr, 0, 0, 0, nullptr, nullptr, 0};
  REQUIRE(reg.add(noCreate).has_value());

  // Duplicate input ids
  static pg::PortDesc dupInputs[] = {{"in", "In", pg::PortKind::Continuous, 1, pg::SignalRole::Any, ""}, {"in", "In2", pg::PortKind::Continuous, 1, pg::SignalRole::Any, ""}};
  static pg::ModuleDescriptor dupInDesc{pg::kModuleAbiVersion, "test.dupIn", "DupIn", "test", "", dupInputs, 2, nullptr, 0, nullptr, 0, 0, 0, [] () -> pg::Module* { return nullptr; }, nullptr, 0};
  REQUIRE(reg.add(dupInDesc).has_value());

  // Duplicate output ids
  static pg::PortDesc dupOutputs[] = {{"out", "Out", pg::PortKind::Continuous, 1, pg::SignalRole::Any, ""}, {"out", "Out2", pg::PortKind::Continuous, 1, pg::SignalRole::Any, ""}};
  static pg::ModuleDescriptor dupOutDesc{pg::kModuleAbiVersion, "test.dupOut", "DupOut", "test", "", nullptr, 0, dupOutputs, 2, nullptr, 0, 0, 0, [] () -> pg::Module* { return nullptr; }, nullptr, 0};
  REQUIRE(reg.add(dupOutDesc).has_value());

  // Duplicate param ids
  static pg::ParamDesc dupParams[] = {
    {"p", "P1", 0.f, 1.f, 0.5f, pg::ParamUnit::None, pg::ParamCurve::Linear, 0, nullptr, 0, "slider", nullptr, ""},
    {"p", "P2", 0.f, 1.f, 0.5f, pg::ParamUnit::None, pg::ParamCurve::Linear, 0, nullptr, 0, "slider", nullptr, ""}
  };
  static pg::ModuleDescriptor dupParamDesc{pg::kModuleAbiVersion, "test.dupParam", "DupParam", "test", "", nullptr, 0, nullptr, 0, dupParams, 2, 0, 0, [] () -> pg::Module* { return nullptr; }, nullptr, 0};
  REQUIRE(reg.add(dupParamDesc).has_value());

  // min >= max
  static pg::ParamDesc badRange{"p", "P", 1.f, 1.f, 0.5f, pg::ParamUnit::None, pg::ParamCurve::Linear, 0, nullptr, 0, "slider", nullptr, ""};
  static pg::ModuleDescriptor badRangeDesc{pg::kModuleAbiVersion, "test.badRange", "BadRange", "test", "", nullptr, 0, nullptr, 0, &badRange, 1, 0, 0, [] () -> pg::Module* { return nullptr; }, nullptr, 0};
  REQUIRE(reg.add(badRangeDesc).has_value());

  // Log param with min <= 0
  static pg::ParamDesc badLog{"c", "C", 0.f, 10.f, 1.f, pg::ParamUnit::Hz, pg::ParamCurve::Log, 0, nullptr, 0, "slider", nullptr, ""};
  static pg::ModuleDescriptor badLogDesc{pg::kModuleAbiVersion, "test.badLog", "BadLog", "test", "", nullptr, 0, nullptr, 0, &badLog, 1, 0, 0, [] () -> pg::Module* { return nullptr; }, nullptr, 0};
  REQUIRE(reg.add(badLogDesc).has_value());

  // Enum param with no labels
  static pg::ParamDesc badEnum{"e", "E", 0.f, 2.f, 0.f, pg::ParamUnit::None, pg::ParamCurve::Linear, pg::kParamEnum, nullptr, 0, "select", nullptr, ""};
  static pg::ModuleDescriptor badEnumDesc{pg::kModuleAbiVersion, "test.badEnum", "BadEnum", "test", "", nullptr, 0, nullptr, 0, &badEnum, 1, 0, 0, [] () -> pg::Module* { return nullptr; }, nullptr, 0};
  REQUIRE(reg.add(badEnumDesc).has_value());

  // Structural param that is also modulatable: a structural value is read once while the instance is built,
  // so there is nowhere for a per-sample modulation signal to go.
  static pg::ParamDesc badStructural{"s", "S", 0.f, 1.f, 0.f, pg::ParamUnit::None, pg::ParamCurve::Linear, pg::kParamStructural | pg::kParamModulatable, nullptr, 0, "select", nullptr, ""};
  static pg::ModuleDescriptor badStructuralDesc{pg::kModuleAbiVersion, "test.badStructural", "BadStructural", "test", "", nullptr, 0, nullptr, 0, &badStructural, 1, 0, 0, [] () -> pg::Module* { return nullptr; }, nullptr, 0};
  REQUIRE(reg.add(badStructuralDesc).has_value());

  // Implicit port collision (modulatable param "gain" collides with declared input "param:gain")
  static pg::PortDesc collideInput[] = {{"param:gain", "Gain In", pg::PortKind::Continuous, 1, pg::SignalRole::Cv, ""}};
  static pg::ParamDesc collideParam{"gain", "Gain", 0.f, 1.f, 0.5f, pg::ParamUnit::None, pg::ParamCurve::Linear, pg::kParamModulatable, nullptr, 0, "slider", nullptr, ""};
  static pg::ModuleDescriptor collideDesc{pg::kModuleAbiVersion, "test.collide", "Collide", "test", "", collideInput, 1, nullptr, 0, &collideParam, 1, 0, 0, [] () -> pg::Module* { return nullptr; }, nullptr, 0};
  REQUIRE(reg.add(collideDesc).has_value());

  // Too many params
  static std::string paramIds[pg::kMaxParamsPerModule + 1];
  static pg::ParamDesc manyParams[pg::kMaxParamsPerModule + 1];
  for (uint32_t i = 0; i <= pg::kMaxParamsPerModule; ++i) {
    paramIds[i] = "p" + std::to_string(i);
    manyParams[i] = {paramIds[i].c_str(), "P", 0.f, 1.f, 0.5f, pg::ParamUnit::None, pg::ParamCurve::Linear, 0, nullptr, 0, "slider", nullptr, ""};
  }
  static pg::ModuleDescriptor tooManyDesc{pg::kModuleAbiVersion, "test.tooMany", "TooMany", "test", "", nullptr, 0, nullptr, 0, manyParams, pg::kMaxParamsPerModule + 1, 0, 0, [] () -> pg::Module* { return nullptr; }, nullptr, 0};
  REQUIRE(reg.add(tooManyDesc).has_value());

  // ABI version mismatch
  static pg::ModuleDescriptor abiMismatch{99, "test.abiMismatch", "ABIMismatch", "test", "", nullptr, 0, nullptr, 0, nullptr, 0, 0, 0, [] () -> pg::Module* { return nullptr; }, nullptr, 0};
  REQUIRE(reg.add(abiMismatch).has_value());

  // Verify one success case registers and is counted
  static pg::PortDesc okOut[] = {{"out", "Out", pg::PortKind::Continuous, 1, pg::SignalRole::Any, ""}};
  static pg::ModuleDescriptor ok{pg::kModuleAbiVersion, "test.ok", "Ok", "test", "", nullptr, 0, okOut, 1, nullptr, 0, 0, 0, [] () -> pg::Module* { return nullptr; }, nullptr, 0};
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

// ---- faces ------------------------------------------------------------------------------------------
//
// A face is rows of tokens naming the module's own ports and params; the registry checks it so a face
// that is wrong is a module that does not register, rather than a node the interface draws wrong.

namespace {
const pg::PortDesc kFaceIn[] = {
  {"a", "A", pg::PortKind::Continuous, 1, pg::SignalRole::Any, ""},
  {"b", "B", pg::PortKind::Continuous, 1, pg::SignalRole::Any, ""},
};
const pg::PortDesc kFaceOut[] = {{"out", "Out", pg::PortKind::Continuous, 1, pg::SignalRole::Any, ""}};
const char* const kEnumLabels[] = {"X", "Y"};
const pg::ParamDesc kFaceParams[] = {
  {"gain", "Gain", 0.f, 1.f, 0.5f, pg::ParamUnit::None, pg::ParamCurve::Linear, pg::kParamModulatable, nullptr, 0, "knob", nullptr, ""},
  {"secret", "Secret", 0.f, 1.f, 0.5f, pg::ParamUnit::None, pg::ParamCurve::Linear, pg::kParamHidden, nullptr, 0, "knob", nullptr, ""},
  {"mode", "Mode", 0.f, 1.f, 0.f, pg::ParamUnit::None, pg::ParamCurve::Linear, pg::kParamEnum | pg::kParamInteger, kEnumLabels, 2, "select", nullptr, ""},
};

pg::ModuleDescriptor faced(const char* id, const char* const* face, uint32_t rows, uint32_t flags = 0) {
  return pg::ModuleDescriptor{pg::kModuleAbiVersion, id, id, "test", "", kFaceIn, 2, kFaceOut, 1, kFaceParams, 3, flags, 0,
                              [] () -> pg::Module* { return nullptr; }, face, rows};
}

std::string rejection(const pg::ModuleDescriptor& d) {
  pg::Registry reg;
  const auto err = reg.add(d);
  return err.has_value() ? *err : "";
}
}  // namespace

TEST_CASE("registry accepts a face and pads it to a rectangle", "[registry][face]") {
  static const char* const rows[] = {
    "a gain gain out",
    "b gain gain",
  };
  static const pg::ModuleDescriptor d = faced("test.face", rows, 2);
  pg::Registry reg;
  REQUIRE(!reg.add(d).has_value());
  const pg::RegisteredModule* m = reg.find("test.face");
  REQUIRE(m->face.size() == 2);
  REQUIRE(m->face[0] == std::vector<std::string>{"a", "gain", "gain", "out"});
  REQUIRE(m->face[1] == std::vector<std::string>{"b", "gain", "gain", "."});
}

TEST_CASE("registry accepts a module with no face", "[registry][face]") {
  static const pg::ModuleDescriptor d = faced("test.noFace", nullptr, 0);
  pg::Registry reg;
  REQUIRE(!reg.add(d).has_value());
  REQUIRE(reg.find("test.noFace")->face.empty());
}

TEST_CASE("registry rejects a face that is wrong", "[registry][face]") {
  // Every port has to be on it.
  static const char* const missing[] = {"a gain gain out", ". gain gain ."};
  REQUIRE(rejection(faced("test.missing", missing, 2)).find("leaves out input `b`") != std::string::npos);

  // A token has to name something.
  static const char* const unknown[] = {"a gain gain out", "b gain gain nope"};
  REQUIRE(rejection(faced("test.unknown", unknown, 2)).find("`nope`") != std::string::npos);

  // A block is a rectangle: an L-shaped gain is two blocks for one knob.
  static const char* const lshape[] = {"a gain gain out", "b gain gain gain", ". gain gain ."};
  REQUIRE(rejection(faced("test.lshape", lshape, 3)).find("not a rectangle") != std::string::npos);

  // One thing, one block: `out` and `out:out` would be two jacks for one port.
  static const char* const twice[] = {"a gain gain out", "b gain gain out:out"};
  REQUIRE(rejection(faced("test.twice", twice, 2)).find("twice") != std::string::npos);

  // A knob needs room.
  static const char* const tiny[] = {"a gain out", "b . ."};
  REQUIRE(rejection(faced("test.tiny", tiny, 2)).find("two cells by two") != std::string::npos);

  // No block for a hidden or an enum param yet.
  static const char* const hidden[] = {"a gain gain secret secret out", "b gain gain secret secret ."};
  REQUIRE(rejection(faced("test.hidden", hidden, 2)).find("hidden") != std::string::npos);
  static const char* const enumP[] = {"a gain gain mode mode out", "b gain gain mode mode ."};
  REQUIRE(rejection(faced("test.enum", enumP, 2)).find("enum") != std::string::npos);

  // The wave panel belongs to a module that can draw one.
  static const char* const wave[] = {"a gain gain wave wave out", "b gain gain wave wave ."};
  REQUIRE(rejection(faced("test.wave", wave, 2)).find("cannot preview") != std::string::npos);
  REQUIRE(rejection(faced("test.waveOk", wave, 2, pg::kModulePreviewsWave)).empty());

  // A pointer with no rows, or rows with no pointer, is a descriptor that disagrees with itself.
  static const char* const rows[] = {"a gain gain out", "b gain gain ."};
  REQUIRE(rejection(faced("test.norows", rows, 0)).find("disagree") != std::string::npos);
}

TEST_CASE("registry resolves a face token that could be two things only when told which", "[registry][face]") {
  // `out` is both an input and an output here.
  static const pg::PortDesc in[] = {{"out", "Out In", pg::PortKind::Continuous, 1, pg::SignalRole::Any, ""}};
  static const pg::PortDesc out[] = {{"out", "Out", pg::PortKind::Continuous, 1, pg::SignalRole::Any, ""}};
  static const char* const bare[] = {"out"};
  static const pg::ModuleDescriptor ambiguous{pg::kModuleAbiVersion, "test.ambiguous", "A", "test", "", in, 1, out, 1, nullptr, 0, 0, 0,
                                             [] () -> pg::Module* { return nullptr; }, bare, 1};
  REQUIRE(rejection(ambiguous).find("ambiguous") != std::string::npos);
  static const char* const said[] = {"in:out out:out"};
  static const pg::ModuleDescriptor clear{pg::kModuleAbiVersion, "test.clear", "A", "test", "", in, 1, out, 1, nullptr, 0, 0, 0,
                                          [] () -> pg::Module* { return nullptr; }, said, 1};
  REQUIRE(rejection(clear).empty());
}

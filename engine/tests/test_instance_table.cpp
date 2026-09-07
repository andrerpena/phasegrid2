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

namespace {
using namespace pg;
const PortDesc kStructuralOut[] = {{"out", "Out", PortKind::Continuous, 1, SignalRole::Any, ""}};
const char* kStructuralShapes[] = {"sine", "square"};
const ParamDesc kStructuralParams[] = {
  {"gain", "Gain", 0.f, 1.f, 1.f, ParamUnit::None, ParamCurve::Linear, kParamModulatable, nullptr, 0, "slider", nullptr, ""},
  {"shape", "Shape", 0.f, 1.f, 0.f, ParamUnit::None, ParamCurve::Linear,
   kParamEnum | kParamInteger | kParamNoSmooth | kParamStructural, kStructuralShapes, 2, "select", nullptr, ""},
};
/// Records what configure() was handed, so the test can prove the message-thread hook runs before prepare().
class Structural : public VoicedModule<int> {
public:
  static inline ParamValues lastConfigured{};
  static inline NodeData lastData = NodeData::object();
  static inline bool configuredBeforePrepare = false;
  void configure(const ParamValues& values, const NodeData& data) override {
    lastConfigured = values; lastData = data; sawConfigure_ = true;
  }
  void onPrepare(const PrepareInfo&) override { configuredBeforePrepare = sawConfigure_; }
  void process(ProcessContext&) override {}
private:
  bool sawConfigure_ = false;
};
const ModuleDescriptor kStructuralDesc{kModuleAbiVersion, "test.structural", "S", "test", "", nullptr, 0,
                                       kStructuralOut, 1, kStructuralParams, 2, 0, 0,
                                       []() -> Module* { return new Structural(); }};
}  // namespace

TEST_CASE("InstanceTable rebuilds only when a structural param changes", "[instance_table]") {
  pg::Registry reg;
  REQUIRE_FALSE(reg.add(kStructuralDesc).has_value());
  pg::InstanceTable table;
  pg::PrepareInfo info{48000.0, pg::kMaxBlockSize, 1};
  auto a = table.acquire("n", *reg.find("test.structural"), info, {{"gain", 0.5f}, {"shape", 0.f}});
  auto b = table.acquire("n", *reg.find("test.structural"), info, {{"gain", 0.1f}, {"shape", 0.f}});   // non-structural change
  REQUIRE(a.get() == b.get());
  auto c = table.acquire("n", *reg.find("test.structural"), info, {{"gain", 0.1f}, {"shape", 1.f}});   // structural change
  REQUIRE(a.get() != c.get());
  REQUIRE(c->structuralValues[1] == 1.f);
  REQUIRE(c->serial != a->serial);
  auto d = table.acquire("n", *reg.find("test.structural"), info, {{"gain", 0.1f}});   // missing = default 0 -> rebuild again
  REQUIRE(d.get() != c.get());
  REQUIRE(d->structuralValues[1] == 0.f);
}

TEST_CASE("InstanceTable configures a new instance with the model params before preparing it", "[instance_table]") {
  pg::Registry reg;
  REQUIRE_FALSE(reg.add(kStructuralDesc).has_value());
  pg::InstanceTable table;
  Structural::lastConfigured.clear();
  Structural::configuredBeforePrepare = false;
  auto inst = table.acquire("n", *reg.find("test.structural"), pg::PrepareInfo{48000.0, pg::kMaxBlockSize, 1},
                            {{"gain", 0.25f}, {"shape", 1.f}});
  REQUIRE(inst != nullptr);
  REQUIRE(Structural::configuredBeforePrepare);
  REQUIRE(Structural::lastConfigured.at("shape") == 1.f);
  REQUIRE(Structural::lastConfigured.at("gain") == 0.25f);
}

#include <catch2/catch_test_macros.hpp>
#include "core/Engine.hpp"
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
                                       []() -> Module* { return new Structural(); }, nullptr, 0};
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
  REQUIRE(c->appliedValues[1] == 1.f);
  REQUIRE(c->serial != a->serial);
  auto d = table.acquire("n", *reg.find("test.structural"), info, {{"gain", 0.1f}});   // missing = default 0 -> rebuild again
  REQUIRE(d.get() != c.get());
  REQUIRE(d->appliedValues[1] == 0.f);
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

TEST_CASE("a structural param set through Engine::setParam is rebuilt on the next commit", "[instance_table][engine]") {
  // `setParam` records ordinary values as applied so the commit-time reconcile does not send them
  // twice. A structural value must NOT be recorded that way: acquire decides to rebuild by finding the
  // snapshot different from the model, and a snapshot updated early tells it there is nothing to do.
  // The symptom was an oscillator whose table was switched over the protocol playing the old table.
  pg::Registry reg;
  REQUIRE_FALSE(reg.add(kStructuralDesc).has_value());
  pg::Engine engine{reg, pg::EngineConfig{48000.0, 64}};
  REQUIRE(engine.model().addNode(reg, {"n", "test.structural", {{"shape", 0.f}}}));
  REQUIRE(engine.commit());
  REQUIRE(Structural::lastConfigured.at("shape") == 0.f);

  REQUIRE(engine.setParam("n", "shape", 1.f));
  REQUIRE(engine.commit());
  REQUIRE(Structural::lastConfigured.at("shape") == 1.f);   // configure ran again: a fresh instance
}

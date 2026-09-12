#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <nlohmann/json.hpp>
#include <string>
#include "core/Module.hpp"
#include "render/PatchFile.hpp"
#include "util/GraphFixture.hpp"

namespace {

/// Stands in for the real consumers of node data (`notes.clip` is next). It reads a number out of its data
/// on the message thread, in `configure`, and holds it out as a constant -- so a change to the data is only
/// visible at all if the instance was rebuilt around it. Validating the shape is the module's own job:
/// nothing between the patch file and here looks inside the object.
struct DataProbe : pg::Module {
  static inline int builds = 0;
  DataProbe() { ++builds; }
  void configure(const pg::ParamValues&, const pg::NodeData& data) override {
    if (data.contains("value") && data["value"].is_number()) value_ = data["value"].get<float>();
  }
  void prepare(const pg::PrepareInfo&) override {}
  void process(pg::ProcessContext& c) override {
    for (uint32_t i = 0; i < c.numFrames; ++i) c.out(0).data[i] = pg::Sample(value_);
  }
  float value_ = -1.f;
};
const pg::PortDesc kProbeOut[] = {{"out", "Out", pg::PortKind::Continuous, 1, pg::SignalRole::Cv, ""}};
const pg::ModuleDescriptor kProbe{pg::kModuleAbiVersion, "test.dataProbe", "DataProbe", "test", "",
  nullptr, 0, kProbeOut, 1, nullptr, 0, 0, 0, [] () -> pg::Module* { return new DataProbe(); }, nullptr, 0};

const char* kPatch = R"({
  "schemaVersion": 1,
  "voiceCount": 2,
  "modules": [
    {"id": "a", "type": "test.const", "params": {"value": 0.25},
     "data": {"notes": [{"beat": 0.5, "pitch": 60, "tags": ["x"]}], "loop": true, "name": "riff", "nothing": null}},
    {"id": "b", "type": "test.const"}
  ],
  "edges": []
})";

}  // namespace

TEST_CASE("a patch round-trips node data unchanged", "[render][node_data]") {
  pg::Registry reg; pg::test::registerTestModules(reg);
  pg::GraphModel model;
  REQUIRE(pg::loadPatchJson(nlohmann::json::parse(kPatch), reg, model));

  const nlohmann::json expected = nlohmann::json::parse(kPatch)["modules"][0]["data"];
  REQUIRE(model.nodes().at("a").data == expected);
  REQUIRE(model.nodes().at("a").data["notes"][0]["pitch"] == 60);
  REQUIRE(model.nodes().at("b").data == nlohmann::json::object());   // no data is an empty object, not null

  const nlohmann::json saved = pg::savePatchJson(model);
  REQUIRE(saved["modules"][0]["data"] == expected);
  REQUIRE_FALSE(saved["modules"][1].contains("data"));   // an empty object is left out rather than written

  pg::GraphModel reloaded;
  REQUIRE(pg::loadPatchJson(saved, reg, reloaded));
  REQUIRE(reloaded.nodes().at("a").data == expected);
  REQUIRE(pg::savePatchJson(reloaded) == saved);         // and the whole document is stable, not just the data
}

TEST_CASE("changing node data rebuilds the instance; anything else reuses it", "[instance_table][node_data]") {
  pg::test::GraphFixture f;
  REQUIRE_FALSE(f.reg.add(kProbe).has_value());
  f.node("n", "test.dataProbe");
  REQUIRE(f.model.setNodeData("n", nlohmann::json{{"value", 0.25}}));

  auto p1 = f.compile();
  const uint64_t first = p1->nodes[0].inst->serial;
  f.run(*p1, 8);
  REQUIRE(f.out(*p1, "n", "out", 0) == Catch::Approx(0.25f));

  auto p2 = f.compile();                                            // nothing changed at all
  REQUIRE(p2->nodes[0].inst->serial == first);

  REQUIRE(f.model.setNodeData("n", nlohmann::json{{"value", 0.25}}));   // the same data, written again
  auto p3 = f.compile();
  REQUIRE(p3->nodes[0].inst->serial == first);

  REQUIRE(f.model.setNodeData("n", nlohmann::json{{"value", 0.75}}));   // different data
  auto p4 = f.compile();
  REQUIRE(p4->nodes[0].inst->serial != first);
  f.run(*p4, 8);
  REQUIRE(f.out(*p4, "n", "out", 0) == Catch::Approx(0.75f));       // the new instance was configured with it
}

TEST_CASE("node data reaches the module before prepare, through configure", "[instance_table][node_data]") {
  pg::Registry reg; pg::test::registerTestModules(reg);
  REQUIRE_FALSE(reg.add(kProbe).has_value());
  pg::InstanceTable table;
  const int before = DataProbe::builds;
  auto inst = table.acquire("n", *reg.find("test.dataProbe"), pg::PrepareInfo{48000.0, pg::kMaxBlockSize, 1}, {},
                            nlohmann::json{{"value", 0.5}});
  REQUIRE(DataProbe::builds == before + 1);
  REQUIRE(inst->nodeData["value"] == 0.5);
  REQUIRE(static_cast<DataProbe*>(inst->module.get())->value_ == Catch::Approx(0.5f));
}

TEST_CASE("malformed node data is a schema error, not a throw", "[render][node_data]") {
  pg::Registry reg; pg::test::registerTestModules(reg);
  pg::GraphModel m;
  auto load = [&](const char* text) { return pg::loadPatchJson(nlohmann::json::parse(text), reg, m); };
  REQUIRE(load(R"({"schemaVersion": 1, "modules": [{"id":"a","type":"test.const","data": 7}]})").code == "E_SCHEMA");
  REQUIRE(load(R"({"schemaVersion": 1, "modules": [{"id":"a","type":"test.const","data": "no"}]})").code == "E_SCHEMA");
  REQUIRE(load(R"({"schemaVersion": 1, "modules": [{"id":"a","type":"test.const","data": [1,2]}]})").code == "E_SCHEMA");
  REQUIRE(load(R"({"schemaVersion": 1, "modules": [{"id":"a","type":"test.const","data": null}]})").code == "E_SCHEMA");
  REQUIRE(load(R"({"schemaVersion": 1, "modules": [{"id":"a","type":"test.const","data": {}}]})"));

  pg::GraphModel direct;
  REQUIRE(direct.addNode(reg, pg::NodeModel{"a", "test.const", {}, nlohmann::json::array()}).code == "E_SCHEMA");
  REQUIRE(direct.addNode(reg, pg::NodeModel{"a", "test.const", {}, nlohmann::json{{"k", 1}}}));
  REQUIRE(direct.setNodeData("a", nlohmann::json(3)).code == "E_SCHEMA");
  REQUIRE(direct.setNodeData("nope", nlohmann::json::object()).code == "E_NODE_NOT_FOUND");
  REQUIRE(direct.nodes().at("a").data["k"] == 1);   // the rejected writes left the good one alone
}

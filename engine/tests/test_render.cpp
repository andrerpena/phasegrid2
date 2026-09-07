#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <cstdio>
#include <filesystem>
#include "core/Engine.hpp"
#include "modules/TestModules.hpp"
#include "modules/builtin.hpp"
#include "render/OfflineRenderer.hpp"
#include "render/PatchFile.hpp"

TEST_CASE("loadPatchFile + renderInterleaved produce the expected samples", "[render]") {
  pg::Registry reg;
  pg::registerBuiltinModules(reg);
  pg::test::registerTestModules(reg);
  pg::Engine engine{reg, pg::EngineConfig{48000.0, 64}};
  REQUIRE(pg::loadPatchFile(std::string(PG_TEST_DIR) + "/golden/const_to_out.json", reg, engine.model()));
  REQUIRE(engine.commit());
  std::vector<float> out = pg::renderInterleaved(engine, pg::RenderOptions{0.01, 2});
  REQUIRE(out.size() == 480 * 2);
  REQUIRE(out[0] == Catch::Approx(0.25f));
  REQUIRE(out[1] == Catch::Approx(0.25f));
  REQUIRE(out[out.size() - 1] == Catch::Approx(0.25f));
  const std::string wav = (std::filesystem::temp_directory_path() / "pg_render_test.wav").string();
  std::string err;
  REQUIRE(pg::writeWav(wav, out, 2, 48000.0, err));
  REQUIRE(std::filesystem::file_size(wav) > 44);
  std::remove(wav.c_str());
}

TEST_CASE("io.audioOut mirrors inL when inR is unconnected and applies gain", "[render]") {
  pg::Registry reg;
  pg::registerBuiltinModules(reg);
  pg::test::registerTestModules(reg);
  pg::Engine engine{reg, pg::EngineConfig{48000.0, 64}};
  REQUIRE(engine.model().addNode(reg, {"c", "test.const", {{"value", 0.5f}}}));
  REQUIRE(engine.model().addNode(reg, {"out", "io.audioOut", {{"gain", 0.5f}}}));
  REQUIRE(engine.model().addEdge(reg, {"e", "c", "out", "out", "inL"}));
  REQUIRE(engine.commit());
  std::vector<float> l(64), r(64); float* planar[2] = {l.data(), r.data()};
  engine.renderBlock(planar, 2, 64, pg::TransportSnapshot{});
  REQUIRE(l[5] == Catch::Approx(0.25f));
  REQUIRE(r[5] == Catch::Approx(0.25f));
}

TEST_CASE("loadPatchJson reports schema errors", "[render]") {
  pg::Registry reg; pg::registerBuiltinModules(reg);
  pg::GraphModel m;
  REQUIRE(pg::loadPatchJson(nlohmann::json::parse(R"({"schemaVersion": 99, "modules": [], "edges": []})"), reg, m).code == "E_SCHEMA");
  REQUIRE(pg::loadPatchJson(nlohmann::json::parse(R"({"schemaVersion": 1, "modules": [{"id":"a","type":"nope"}], "edges": []})"), reg, m).code == "E_UNKNOWN_TYPE");
  REQUIRE(pg::loadPatchJson(nlohmann::json::parse(R"({"schemaVersion": 1, "modules": [], "edges": [], "feedbackMode": "block"})"), reg, m));
  REQUIRE(m.feedbackMode == pg::FeedbackMode::Block);
}

// Malformed patches must come back as E_SCHEMA, never as an uncaught nlohmann type_error:
// phase 4 feeds this loader straight from IPC, where a throw would kill the engine process.
TEST_CASE("loadPatchJson rejects wrong JSON types instead of throwing", "[render]") {
  pg::Registry reg; pg::registerBuiltinModules(reg);
  pg::GraphModel m;
  auto load = [&](const char* text) { return pg::loadPatchJson(nlohmann::json::parse(text), reg, m); };

  REQUIRE(load(R"({"schemaVersion": 1, "modules": [1, 2, 3]})").code == "E_SCHEMA");
  REQUIRE(load(R"({"schemaVersion": 1, "modules": "notanarray"})").code == "E_SCHEMA");
  REQUIRE(load(R"({"schemaVersion": 1, "modules": [], "edges": [7]})").code == "E_SCHEMA");
  REQUIRE(load(R"({"schemaVersion": 1, "modules": [], "edges": "notanarray"})").code == "E_SCHEMA");
  REQUIRE(load(R"({"schemaVersion": 1, "modules": [{"id": "a", "type": "io.audioOut", "params": 3}]})").code == "E_SCHEMA");
  REQUIRE(load(R"({"schemaVersion": 1, "modules": [],
                   "edges": [{"id": "e", "from": "a.out", "to": {"module": "b", "port": "inL"}}]})").code == "E_SCHEMA");
  REQUIRE(load(R"({"schemaVersion": 1, "voiceCount": "two", "modules": []})").code == "E_SCHEMA");
}

TEST_CASE("loadPatchJson surfaces GraphModel errors for bad edges", "[render]") {
  pg::Registry reg; pg::registerBuiltinModules(reg); pg::test::registerTestModules(reg);
  pg::GraphModel m;
  auto load = [&](const char* text) { return pg::loadPatchJson(nlohmann::json::parse(text), reg, m); };

  // Two edges sharing an id: GraphModel::addEdge reports E_DUP_ID.
  REQUIRE(load(R"({"schemaVersion": 1,
                   "modules": [{"id": "c", "type": "test.const"}, {"id": "o", "type": "io.audioOut"}],
                   "edges": [{"id": "e1", "from": {"module": "c", "port": "out"}, "to": {"module": "o", "port": "inL"}},
                             {"id": "e1", "from": {"module": "c", "port": "out"}, "to": {"module": "o", "port": "inR"}}]})")
              .code == "E_DUP_ID");

  // An edge endpoint no module declares: GraphModel::addEdge reports E_NODE_NOT_FOUND.
  REQUIRE(load(R"({"schemaVersion": 1,
                   "modules": [{"id": "o", "type": "io.audioOut"}],
                   "edges": [{"id": "e1", "from": {"module": "ghost", "port": "out"}, "to": {"module": "o", "port": "inL"}}]})")
              .code == "E_NODE_NOT_FOUND");
}

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

// golden/silence.json is the patch docs/engine.md prints for `--render`: it must stay loadable with
// only the builtin registry, because the CLI never registers the test modules.
TEST_CASE("golden/silence.json loads with builtin modules alone", "[render]") {
  pg::Registry reg;
  pg::registerBuiltinModules(reg);
  pg::Engine engine{reg, pg::EngineConfig{48000.0, 64}};
  REQUIRE(pg::loadPatchFile(std::string(PG_TEST_DIR) + "/golden/silence.json", reg, engine.model()));
  REQUIRE(engine.commit());
  const std::vector<float> out = pg::renderInterleaved(engine, pg::RenderOptions{0.01, 2});
  REQUIRE(out.size() == 480 * 2);
  for (float v : out) REQUIRE(v == 0.f);
}

// golden/const_to_out.json uses test.const, which only pg_tests registers, so it is a test-only
// fixture: `phasegrid-engine --render` on it exits 1 with E_UNKNOWN_TYPE.
TEST_CASE("golden/const_to_out.json is a test-only fixture", "[render]") {
  pg::Registry reg;
  pg::registerBuiltinModules(reg);   // no test modules: this is what the CLI sees
  pg::GraphModel m;
  REQUIRE(pg::loadPatchFile(std::string(PG_TEST_DIR) + "/golden/const_to_out.json", reg, m).code == "E_UNKNOWN_TYPE");
}

// Guards the ~6 lines that decide which lane reaches which speaker: the out[0]/out[1] fold in
// Engine::renderBlock, the lanes::left()/right() masks in io.audioOut, and swapVoices vs swapStereo.
// Every other source in the suite is symmetric, so only an asymmetric signal can fail on a swap.
TEST_CASE("left and right stay distinct through renderBlock", "[render]") {
  pg::Registry reg;
  pg::registerBuiltinModules(reg);
  pg::test::registerTestModules(reg);
  pg::Engine engine{reg, pg::EngineConfig{48000.0, 64}};
  REQUIRE(engine.model().addNode(reg, {"s", "test.stereo", {{"l", 0.25f}, {"r", -0.5f}}}));
  REQUIRE(engine.model().addNode(reg, {"out", "io.audioOut", {{"gain", 1.f}}}));
  REQUIRE(engine.model().addEdge(reg, {"eL", "s", "out", "out", "inL"}));
  REQUIRE(engine.model().addEdge(reg, {"eR", "s", "out", "out", "inR"}));
  REQUIRE(engine.commit());
  std::vector<float> l(64, 99.f), r(64, 99.f); float* planar[2] = {l.data(), r.data()};
  engine.renderBlock(planar, 2, 64, pg::TransportSnapshot{});
  for (uint32_t i = 0; i < 64; ++i) {
    REQUIRE(l[i] == 0.25f);    // left channel only
    REQUIRE(r[i] == -0.5f);    // right channel only
  }
}

TEST_CASE("left and right stay distinct through renderInterleaved", "[render]") {
  pg::Registry reg;
  pg::registerBuiltinModules(reg);
  pg::test::registerTestModules(reg);
  pg::Engine engine{reg, pg::EngineConfig{48000.0, 64}};
  REQUIRE(engine.model().addNode(reg, {"s", "test.stereo", {{"l", 0.25f}, {"r", -0.5f}}}));
  REQUIRE(engine.model().addNode(reg, {"out", "io.audioOut", {{"gain", 1.f}}}));
  REQUIRE(engine.model().addEdge(reg, {"eL", "s", "out", "out", "inL"}));
  REQUIRE(engine.model().addEdge(reg, {"eR", "s", "out", "out", "inR"}));
  REQUIRE(engine.commit());
  const std::vector<float> out = pg::renderInterleaved(engine, pg::RenderOptions{0.01, 2});
  REQUIRE(out.size() == 480 * 2);
  for (size_t f = 0; f < out.size() / 2; ++f) {
    REQUIRE(out[f * 2] == 0.25f);        // L of frame f
    REQUIRE(out[f * 2 + 1] == -0.5f);    // R of frame f
  }
}

// Four voices is two pairs, and two pairs is the first count at which the scheduler runs its op list
// more than once per block. Voice allocation does not exist yet (it arrives with note.toPoly), so every
// voice carries the same signal and the output scales with the voice count -- which is exactly what a
// pair silently dropped, or a pair counted twice, would break.
// One asymmetric constant into io.audioOut at `voices` voices. Every voice carries the same signal
// (voice allocation arrives with note.toPoly), so the output is exactly `voices` copies of it.
static std::pair<std::vector<float>, std::vector<float>> renderVoices(uint32_t voices) {
  pg::Registry reg;
  pg::registerBuiltinModules(reg);
  pg::test::registerTestModules(reg);
  pg::Engine engine{reg, pg::EngineConfig{48000.0, 64}};
  REQUIRE(engine.model().setVoiceCount(voices));
  REQUIRE(engine.model().addNode(reg, {"s", "test.stereo", {{"l", 0.25f}, {"r", -0.5f}}}));
  REQUIRE(engine.model().addNode(reg, {"out", "io.audioOut", {{"gain", 1.f}}}));
  REQUIRE(engine.model().addEdge(reg, {"eL", "s", "out", "out", "inL"}));
  REQUIRE(engine.model().addEdge(reg, {"eR", "s", "out", "out", "inR"}));
  REQUIRE(engine.commit());
  std::vector<float> l(64, 99.f), r(64, 99.f); float* planar[2] = {l.data(), r.data()};
  engine.renderBlock(planar, 2, 64, pg::TransportSnapshot{});
  return {l, r};
}

TEST_CASE("a four-voice program renders every voice", "[render]") {
  const auto [l2, r2] = renderVoices(2);
  const auto [l4, r4] = renderVoices(4);
  for (uint32_t i = 0; i < 64; ++i) {
    REQUIRE(l2[i] == Catch::Approx(2 * 0.25f));    // one pair: two voices
    REQUIRE(r2[i] == Catch::Approx(2 * -0.5f));
    REQUIRE(l4[i] == Catch::Approx(4 * 0.25f));    // two pairs: four voices, none lost
    REQUIRE(r4[i] == Catch::Approx(4 * -0.5f));
  }
}

// An odd voice count leaves the top pair holding one real voice and one empty lane. Masking that lane is
// the terminal's job, because by the time renderBlock folds the bus every pair has already added into it
// and there is no single mask that describes the sum -- masking the fold with pair 0's mask lets the empty
// lane of the last pair through as a phantom voice.
TEST_CASE("an odd voice count produces no phantom voice", "[render]") {
  for (uint32_t voices : {1u, 3u, 5u, 7u}) {
    const auto [l, r] = renderVoices(voices);
    for (uint32_t i = 0; i < 64; ++i) {
      REQUIRE(l[i] == Catch::Approx(static_cast<float>(voices) * 0.25f));
      REQUIRE(r[i] == Catch::Approx(static_cast<float>(voices) * -0.5f));
    }
  }
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

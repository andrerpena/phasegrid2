#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <nlohmann/json.hpp>
#include <algorithm>
#include <cstdio>
#include <map>
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

// An eight-note chord into an instrument of `voices` voices, each voice turned into a constant 0.1 by a
// scale/offset fed from its gate, and summed at the output: the output is 0.1 times the number of
// voices that got a note, which is exactly what a pair silently dropped, a pair counted twice, or a
// pool that did not cap would break. A tenth rather than a quarter because the device boundary clamps
// at full scale, and seven quarters is past it.
static std::pair<std::vector<float>, std::vector<float>> renderVoices(uint32_t voices) {
  pg::Registry reg;
  pg::registerBuiltinModules(reg);
  pg::test::registerTestModules(reg);
  pg::Engine engine{reg, pg::EngineConfig{48000.0, 64}};
  REQUIRE(engine.model().addNode(reg, {"pat", "notes.pattern", {{"legato", 1.f}}}));
  REQUIRE(engine.model().setNodeData("pat", nlohmann::json{{"pattern", "[c3,e3,g3,bb3,d4,f4,a4,c5]"}}));
  REQUIRE(engine.model().addNode(reg, {"poly", "note.toPoly", {{"voices", static_cast<float>(voices)}}}));
  REQUIRE(engine.model().addNode(reg, {"level", "math.scaleOffset", {{"scale", 0.f}, {"offset", 0.1f}}}));
  REQUIRE(engine.model().addNode(reg, {"out", "io.audioOut", {{"gain", 1.f}}}));
  REQUIRE(engine.model().addEdge(reg, {"e1", "pat", "notes", "poly", "notes"}));
  REQUIRE(engine.model().addEdge(reg, {"e2", "poly", "gate", "level", "in"}));
  REQUIRE(engine.model().addEdge(reg, {"eL", "level", "out", "out", "inL"}));
  REQUIRE(engine.commit());
  std::vector<float> l(64, 99.f), r(64, 99.f); float* planar[2] = {l.data(), r.data()};
  engine.renderBlock(planar, 2, 64, pg::TransportSnapshot{});
  return {l, r};
}

TEST_CASE("a four-voice instrument renders every voice, and a two-voice one caps the chord", "[render]") {
  const auto [l2, r2] = renderVoices(2);
  const auto [l4, r4] = renderVoices(4);
  for (uint32_t i = 0; i < 64; ++i) {
    REQUIRE(l2[i] == Catch::Approx(2 * 0.1f));    // one pair: two voices, the other six notes stolen away
    REQUIRE(r2[i] == Catch::Approx(2 * 0.1f));    // the right channel mirrors the left when only inL is cabled
    REQUIRE(l4[i] == Catch::Approx(4 * 0.1f));    // two pairs: four voices, none lost
    REQUIRE(r4[i] == Catch::Approx(4 * 0.1f));
  }
}

// An odd pool leaves the top pair holding one real voice and one empty lane. Masking that lane is the
// exit's job, because by the time renderBlock folds the bus every pair has already added into it and
// there is no single mask that describes the sum -- masking the fold with pair 0's mask lets the empty
// lane of the last pair through as a phantom voice.
TEST_CASE("an odd voice count produces no phantom voice", "[render]") {
  for (uint32_t voices : {1u, 3u, 5u, 7u}) {
    const auto [l, r] = renderVoices(voices);
    for (uint32_t i = 0; i < 64; ++i) {
      REQUIRE(l[i] == Catch::Approx(static_cast<float>(voices) * 0.1f));
      REQUIRE(r[i] == Catch::Approx(static_cast<float>(voices) * 0.1f));
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

TEST_CASE("the master output level silences both render paths", "[render]") {
  // The device path is `renderInterleaved`, not `renderBlock`, and a control that only worked on the
  // one the tests happened to use would look right in every test and do nothing in the application.
  pg::Registry reg;
  pg::registerBuiltinModules(reg);
  pg::Engine engine{reg, pg::EngineConfig{48000.0, 64}};
  REQUIRE(engine.model().addNode(reg, {"src", "math.scaleOffset", {{"offset", 0.5f}}}));
  REQUIRE(engine.model().addNode(reg, {"out", "io.audioOut", {}}));
  REQUIRE(engine.model().addEdge(reg, {"e1", "src", "out", "out", "inL"}));
  REQUIRE(engine.commit());

  std::vector<float> l(64), r(64);
  float* planar[2] = {l.data(), r.data()};
  std::vector<float> interleaved(128);
  pg::TransportSnapshot t;
  pg::Transport clock;
  clock.prepare(48000.0);

  engine.renderBlock(planar, 2, 64, t);
  REQUIRE(l[0] != 0.f);
  engine.renderInterleaved(interleaved.data(), 64, 2, clock);
  REQUIRE(interleaved[0] != 0.f);

  engine.setOutputGain(0.f);
  engine.renderBlock(planar, 2, 64, t);
  REQUIRE(l[0] == 0.f);
  std::fill(interleaved.begin(), interleaved.end(), 1.f);
  engine.renderInterleaved(interleaved.data(), 64, 2, clock);
  REQUIRE(interleaved[0] == 0.f);
  REQUIRE(interleaved[63] == 0.f);
}

TEST_CASE("the device period does not change the sound", "[render][clock]") {
  /*
   * The bug this guards. The transport used to be advanced once per DEVICE CALLBACK, and every engine
   * block inside that callback was handed the same snapshot, so a note source replayed the same 64
   * frames of musical time once per block and retriggered every note it was holding -- a creak, live,
   * on any device period above one block. Nothing offline could see it: the offline renderer advanced
   * per block and never went through the splitter. Now both go through Engine::renderInterleaved, and
   * this asks the only question that matters: is the audio identical whatever the callback size?
   * Identical means identical -- same code, same 64-frame blocks inside, same clock -- not close.
   */
  auto render = [](uint32_t period) {
    pg::Registry reg;
    pg::registerBuiltinModules(reg);
    pg::Engine engine{reg, pg::EngineConfig{48000.0, 64}};
    REQUIRE(engine.model().addNode(reg, {"pat", "notes.pattern", {{"legato", 0.9f}, {"cycle", 4.f}}}));
    REQUIRE(engine.model().setNodeData("pat", nlohmann::json{{"pattern", "c3 e3 b3 c4"}}));
    REQUIRE(engine.model().addNode(reg, {"poly", "note.toPoly", {}}));
    REQUIRE(engine.model().addNode(reg, {"osc", "osc.sine", {}}));
    REQUIRE(engine.model().addNode(reg, {"out", "io.audioOut", {}}));
    REQUIRE(engine.model().addEdge(reg, {"e1", "pat", "notes", "poly", "notes"}));
    REQUIRE(engine.model().addEdge(reg, {"e2", "poly", "pitch", "osc", "pitch"}));
    REQUIRE(engine.model().addEdge(reg, {"e3", "osc", "out", "out", "inL"}));
    REQUIRE(engine.commit());
    pg::RenderOptions o;
    o.seconds = 2.0;
    o.period = period;
    std::vector<float> out = pg::renderInterleaved(engine, o);
    // And the engine itself agrees the clock it was fed was contiguous.
    REQUIRE(engine.clockDiscontinuities() == 0);
    return out;
  };
  const std::vector<float> reference = render(64);
  REQUIRE(*std::max_element(reference.begin(), reference.end()) > 0.5f);   // it plays at all
  for (const uint32_t period : {100u, 128u, 512u, 1024u}) {
    INFO("device period " << period << " frames");
    const std::vector<float> other = render(period);
    REQUIRE(other.size() == reference.size());
    size_t firstDifference = reference.size();
    for (size_t i = 0; i < reference.size(); ++i)
      if (other[i] != reference[i]) { firstDifference = i; break; }
    INFO("first differing sample: " << firstDifference << " of " << reference.size());
    REQUIRE(firstDifference == reference.size());
  }
}

TEST_CASE("the output clips like the reference instrument, and the device boundary clamps what is left", "[render][clip]") {
  /*
   * Three unity constants into one input sum to 3.0, which is what a three-voice chord of unity sines
   * does at its peaks, and what the patch that was "rough again" did. The output module clips the way
   * the reference instrument's Audio Out does -- a mode and the level it engages at, Hard at +6 dB by
   * default -- and whatever is still over full scale after the master gain is clamped at the device
   * boundary and counted, so a patch that is too loud is a number rather than a mystery.
   */
  auto render = [](std::map<std::string, float> outParams) {
    pg::Registry reg;
    pg::registerBuiltinModules(reg);
    pg::test::registerTestModules(reg);
    pg::Engine engine{reg, pg::EngineConfig{48000.0, 64}};
    for (const char* id : {"a", "b", "c"}) REQUIRE(engine.model().addNode(reg, {id, "test.const", {{"value", 1.f}}}));
    REQUIRE(engine.model().addNode(reg, {"out", "io.audioOut", std::move(outParams)}));
    for (const char* id : {"a", "b", "c"}) REQUIRE(engine.model().addEdge(reg, {std::string("e") + id, id, "out", "out", "inL"}));
    REQUIRE(engine.commit());
    pg::RenderOptions o;
    o.seconds = 0.01;
    const std::vector<float> out = pg::renderInterleaved(engine, o);
    return std::pair{out[200], engine.deviceClips()};   // L of frame 100, well past any ramp
  };
  // Defaults, Hard at +6 dB: the module clamps 3.0 to 2.0, the boundary clamps that to 1.0 and says so.
  {
    const auto [v, clips] = render({});
    REQUIRE(v == 1.f);
    REQUIRE(clips > 0);
  }
  // Hard at 0 dB: the module itself brings it to full scale; the boundary has nothing left to do.
  {
    const auto [v, clips] = render({{"clipLevel", 0.f}});
    REQUIRE(v == 1.f);
    REQUIRE(clips == 0);
  }
  // Soft at 0 dB: a tanh knee, under full scale on its own, and nothing for the boundary.
  {
    const auto [v, clips] = render({{"clip", 2.f}, {"clipLevel", 0.f}});
    REQUIRE(v > 0.9f);
    REQUIRE(v < 1.f);
    REQUIRE(clips == 0);
  }
  // Off: the module passes 3.0 through and the boundary does all of the clipping, counted.
  {
    const auto [v, clips] = render({{"clip", 0.f}});
    REQUIRE(v == 1.f);
    REQUIRE(clips > 0);
  }
}

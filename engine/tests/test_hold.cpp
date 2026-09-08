#include <unistd.h>

#include <atomic>
#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <string>
#include <vector>

#include "core/Engine.hpp"
#include "modules/builtin.hpp"
#include "services/PreviewPublisher.hpp"
#include "services/Telemetry.hpp"

using namespace pg;

/**
 * Stop stops the patch.
 *
 * A modular is not gated by its clock, so for a while the only way to stop one was to silence the
 * output -- which hid a running patch rather than stopping it. Nobody could tell until the canvas
 * learned to show what the engine was doing, and then a stopped project sat there with its knobs
 * turning and its faces animating with nothing to hear. These are the four things Stop has to mean.
 */
namespace {

std::string uniqueName(const char* tag) {
  static std::atomic<int> counter{0};
  return std::string("/pg-hold-") + tag + "-" + std::to_string(getpid()) + "-" +
         std::to_string(counter.fetch_add(1));
}

/// A sine at middle C into the output, with an LFO on its Fold.
struct Rig {
  Registry registry;
  Engine engine{registry, EngineConfig{48000.0, 64}};
  std::vector<float> left = std::vector<float>(64), right = std::vector<float>(64);

  Rig() {
    registerBuiltinModules(registry);
    REQUIRE(engine.model().addNode(registry, {"lfo", "mod.lfo", {{"rate", 20.f}, {"depth", 1.f}}}));
    REQUIRE(engine.model().addNode(registry, {"osc", "osc.sine", {{"fold", 12.f}}}));
    REQUIRE(engine.model().addNode(registry, {"out", "io.audioOut", {}}));
    REQUIRE(engine.model().addEdge(registry, {"e1", "lfo", "out", "osc", "param:fold"}));
    REQUIRE(engine.model().addEdge(registry, {"e2", "osc", "out", "out", "inL"}));
    REQUIRE(engine.commit());
  }

  /// Renders `blocks` and returns every left sample.
  std::vector<float> render(uint32_t blocks) {
    std::vector<float> all;
    float* planar[2] = {left.data(), right.data()};
    TransportSnapshot t;
    for (uint32_t i = 0; i < blocks; ++i) {
      engine.renderBlock(planar, 2, 64, t);
      all.insert(all.end(), left.begin(), left.end());
    }
    return all;
  }
};

bool silent(const std::vector<float>& v) {
  for (float x : v)
    if (x != 0.f) return false;
  return true;
}

}  // namespace

TEST_CASE("a held patch makes no sound", "[hold]") {
  Rig rig;
  REQUIRE_FALSE(silent(rig.render(4)));   // audible first, or silence proves nothing
  rig.engine.setRunning(false);
  REQUIRE(silent(rig.render(4)));
  rig.engine.setRunning(true);
  REQUIRE_FALSE(silent(rig.render(4)));
}

TEST_CASE("holding advances nothing: the sound picks up exactly where it left off", "[hold]") {
  // Two identical engines, one played straight through and one held in the middle. Every sample
  // after the hold has to match, or something moved while the patch was stopped.
  Rig straight, held;
  straight.render(5);
  held.render(5);
  held.engine.setRunning(false);
  REQUIRE(silent(held.render(5)));
  held.engine.setRunning(true);

  const std::vector<float> expected = straight.render(5);
  const std::vector<float> actual = held.render(5);
  REQUIRE(actual.size() == expected.size());
  for (size_t i = 0; i < expected.size(); ++i) {
    INFO("sample " << i);
    REQUIRE(actual[i] == expected[i]);
  }
}

TEST_CASE("a held patch stops publishing, so the interface stops moving", "[hold][telemetry]") {
  Rig rig;
  TelemetryWriter writer;
  std::string error;
  REQUIRE(writer.create(uniqueName("params"), 4, 48000.0, 64, error));
  rig.engine.setTelemetry(&writer);
  REQUIRE(rig.engine.setTelemetrySlot("osc", 0));

  rig.render(2);
  const uint32_t moving = writer.slot(0)->seq.load();
  REQUIRE(moving > 0);
  rig.render(2);
  REQUIRE(writer.slot(0)->seq.load() > moving);   // it was moving, and that is the point

  rig.engine.setRunning(false);
  const uint32_t held = writer.slot(0)->seq.load();
  rig.render(8);
  REQUIRE(writer.slot(0)->seq.load() == held);
}

TEST_CASE("a face held still shows what the patch is set to, and follows a knob", "[hold][preview]") {
  // Building a patch in silence has to work: nothing is running to have a live value, so the picture
  // is the document's, and it redraws when the knob moves.
  Rig rig;
  TelemetryWriter writer;
  std::string error;
  REQUIRE(writer.create(uniqueName("preview"), 4, 48000.0, 64, error));
  rig.engine.setTelemetry(&writer);
  PreviewPublisher publisher{rig.engine, writer};
  REQUIRE(rig.engine.setPreviewSlot("osc", 0));

  rig.render(4);                     // the LFO has moved Fold well away from the document's twelve
  rig.engine.setRunning(false);
  publisher.tick();
  std::vector<float> document(kPreviewFrames);
  REQUIRE(rig.engine.preview("osc", document.data(), kPreviewFrames));
  const float* published = writer.payload(0);
  for (uint32_t i = 0; i < kPreviewFrames; ++i) REQUIRE(published[i] == document[i]);

  // And a knob turned while it is held reaches both the picture and, when it plays again, the sound.
  const uint32_t before = writer.slot(0)->seq.load();
  REQUIRE(rig.engine.setParam("osc", "fold", 36.f));
  publisher.tick();
  REQUIRE(writer.slot(0)->seq.load() > before);
  REQUIRE(rig.engine.preview("osc", document.data(), kPreviewFrames));
  for (uint32_t i = 0; i < kPreviewFrames; ++i) REQUIRE(writer.payload(0)[i] == document[i]);
}

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
#include "util/RtGuard.hpp"

using namespace pg;

/**
 * A face follows the sound.
 *
 * The publisher's promise is that a watched module's picture is the one its module would draw for
 * the values it is actually running with, that it is redrawn when those values move and only then,
 * and that a module nobody asked about costs nothing.
 */
namespace {

std::string uniqueName(const char* tag) {
  static std::atomic<int> counter{0};
  return std::string("/pg-preview-") + tag + "-" + std::to_string(getpid()) + "-" +
         std::to_string(counter.fetch_add(1));
}

/// An LFO into the sine's Fold, the sine into the output; a meter for the display case.
struct Rig {
  Registry registry;
  Engine engine{registry, EngineConfig{48000.0, 64}};
  TelemetryWriter writer;
  PreviewPublisher publisher{engine, writer};
  std::vector<float> left = std::vector<float>(64), right = std::vector<float>(64);

  explicit Rig(const char* tag, bool modulated = true) {
    registerBuiltinModules(registry);
    std::string error;
    REQUIRE(writer.create(uniqueName(tag), 8, 48000.0, 64, error));
    engine.setTelemetry(&writer);
    REQUIRE(engine.model().addNode(registry, {"lfo", "mod.lfo", {{"rate", 20.f}, {"depth", 1.f}}}));
    REQUIRE(engine.model().addNode(registry, {"osc", "osc.sine", {{"fold", 12.f}}}));
    REQUIRE(engine.model().addNode(registry, {"meter", "display.meter", {}}));
    REQUIRE(engine.model().addNode(registry, {"out", "io.audioOut", {}}));
    if (modulated) REQUIRE(engine.model().addEdge(registry, {"e1", "lfo", "out", "osc", "param:fold"}));
    REQUIRE(engine.model().addEdge(registry, {"e2", "osc", "out", "out", "inL"}));
    REQUIRE(engine.model().addEdge(registry, {"e3", "osc", "out", "meter", "in"}));
    REQUIRE(engine.commit());
  }

  void render(uint32_t blocks = 1) {
    float* planar[2] = {left.data(), right.data()};
    TransportSnapshot t;
    for (uint32_t i = 0; i < blocks; ++i) engine.renderBlock(planar, 2, 64, t);
  }
  std::vector<float> slotSamples(uint32_t slot) {
    const TelemetrySlotHeader* h = writer.slot(slot);
    const float* p = writer.payload(slot);
    return std::vector<float>(p, p + h->frames);
  }
};

}  // namespace

TEST_CASE("a watched module's picture is published on the tick", "[preview]") {
  Rig rig{"publish"};
  REQUIRE(rig.engine.setSlot("osc", TelemetryChannel::Preview, 3));
  rig.publisher.tick();

  const TelemetrySlotHeader* slot = rig.writer.slot(3);
  REQUIRE(slot->kind == static_cast<uint32_t>(TelemetryKind::Preview));
  REQUIRE(slot->channels == 1);
  REQUIRE(slot->frames == kPreviewFrames);
  REQUIRE(slot->seq.load() % 2 == 0);
  REQUIRE(rig.publisher.published() == 1);
}

TEST_CASE("nothing is published for a module nobody asked about", "[preview]") {
  Rig rig{"silent"};
  rig.render(4);
  rig.publisher.tick();
  for (uint32_t i = 0; i < 8; ++i) REQUIRE(rig.writer.slot(i)->seq.load() == 0);
  REQUIRE(rig.publisher.published() == 0);
}

TEST_CASE("before the module has run, the picture is the document's", "[preview]") {
  // The engine's own answer to `module.preview` is the document's picture; the two must agree, or a
  // face would jump the moment a subscription started.
  Rig rig{"document", /*modulated=*/false};
  REQUIRE(rig.engine.setSlot("osc", TelemetryChannel::Preview, 0));
  rig.publisher.tick();
  std::vector<float> expected(kPreviewFrames);
  REQUIRE(rig.engine.preview("osc", expected.data(), kPreviewFrames));
  REQUIRE(rig.slotSamples(0) == expected);
}

TEST_CASE("an unchanged module is not redrawn", "[preview]") {
  Rig rig{"still", /*modulated=*/false};
  REQUIRE(rig.engine.setSlot("osc", TelemetryChannel::Preview, 0));
  rig.publisher.tick();
  rig.render(8);
  rig.publisher.tick();
  rig.publisher.tick();
  // One publish for the first look, and one when the module's live values first arrived (they match
  // the document's, but the source changed); nothing after that.
  REQUIRE(rig.publisher.published() <= 2);
  const uint32_t seq = rig.writer.slot(0)->seq.load();
  rig.render(8);
  rig.publisher.tick();
  REQUIRE(rig.writer.slot(0)->seq.load() == seq);
}

TEST_CASE("a modulated module's picture follows the values it runs with", "[preview]") {
  Rig rig{"follows"};
  REQUIRE(rig.engine.setSlot("osc", TelemetryChannel::Preview, 1));
  rig.render();
  rig.publisher.tick();
  const std::vector<float> first = rig.slotSamples(1);
  // At 20 Hz the LFO moves the fold a long way in twelve blocks, so the shape has to differ.
  rig.render(12);
  rig.publisher.tick();
  const std::vector<float> second = rig.slotSamples(1);
  REQUIRE(first != second);
  REQUIRE(rig.publisher.published() == 2);
  // And it is no longer the document's picture: the document still says twelve semitones.
  std::vector<float> document(kPreviewFrames);
  REQUIRE(rig.engine.preview("osc", document.data(), kPreviewFrames));
  REQUIRE(second != document);
}

TEST_CASE("a display module has no picture to publish", "[preview]") {
  Rig rig{"display"};
  REQUIRE(rig.engine.setSlot("meter", TelemetryChannel::Preview, 2));
  rig.render();
  rig.publisher.tick();
  REQUIRE(rig.writer.slot(2)->seq.load() == 0);
}

TEST_CASE("clearing subscriptions stops the pictures too", "[preview]") {
  Rig rig{"clear"};
  REQUIRE(rig.engine.setSlot("osc", TelemetryChannel::Preview, 0));
  rig.publisher.tick();
  const uint32_t seq = rig.writer.slot(0)->seq.load();
  REQUIRE(seq > 0);
  rig.engine.clearSlots();
  rig.render(8);
  rig.publisher.tick();
  REQUIRE(rig.writer.slot(0)->seq.load() == seq);
}

TEST_CASE("recording live values for a watched module allocates nothing", "[preview][rt]") {
  Rig rig{"rt"};
  REQUIRE(rig.engine.setSlot("osc", TelemetryChannel::Preview, 0));
  rig.render();
  REQUIRE(rig.engine.hasInstance("osc"));
  {
    pg::test::RtScope rt;
    rig.render(200);
  }
  rig.publisher.tick();
  REQUIRE(rig.writer.slot(0)->seq.load() > 0);
}

TEST_CASE("a module moved to another slot is drawn again there, unchanged or not", "[preview]") {
  // A resubscription numbers the slots afresh -- a knob gaining a cable puts a params slot in front of
  // every picture -- so a module whose values have not moved still owes its new slot a picture. Before
  // this was checked, each face showed whatever its neighbour had last drawn into that slot.
  Rig rig{"moved", /*modulated=*/false};
  REQUIRE(rig.engine.setSlot("osc", TelemetryChannel::Preview, 0));
  rig.publisher.tick();
  const uint32_t drawnInto0 = rig.writer.slot(0)->seq.load();
  REQUIRE(drawnInto0 > 0);
  REQUIRE(rig.writer.slot(1)->seq.load() == 0);

  rig.engine.clearSlots();
  REQUIRE(rig.engine.setSlot("osc", TelemetryChannel::Preview, 1));
  rig.publisher.tick();
  REQUIRE(rig.writer.slot(1)->seq.load() > 0);
  REQUIRE(rig.slotSamples(1) == rig.slotSamples(0));
}

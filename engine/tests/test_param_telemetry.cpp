#include <unistd.h>

#include <atomic>
#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <string>
#include <vector>

#include "core/Engine.hpp"
#include "modules/builtin.hpp"
#include "services/Telemetry.hpp"
#include "util/RtGuard.hpp"

using namespace pg;

/**
 * A subscribed module publishes its effective parameter values.
 *
 * This is what lets a knob on the interface turn when something modulates it: the value the module
 * actually used this block, after the signal on its `param:` input was added, in display units. It is
 * written by the scheduler for any module subscribed on the `params` channel, so no module has to know
 * about it -- including one that publishes a picture of its own, which does that on another channel and
 * into another slot.
 */
namespace {

std::string uniqueName(const char* tag) {
  static std::atomic<int> counter{0};
  return std::string("/pg-params-") + tag + "-" + std::to_string(getpid()) + "-" +
         std::to_string(counter.fetch_add(1));
}

/// An LFO into the VCA's gain knob: the gain the VCA uses moves every block.
struct Rig {
  Registry registry;
  Engine engine{registry, EngineConfig{48000.0, 64}};
  TelemetryWriter writer;
  std::vector<float> left = std::vector<float>(64), right = std::vector<float>(64);

  explicit Rig(const char* tag) {
    registerBuiltinModules(registry);
    std::string error;
    REQUIRE(writer.create(uniqueName(tag), 8, 48000.0, 64, error));
    engine.setTelemetry(&writer);
    REQUIRE(engine.model().addNode(registry, {"src", "math.scaleOffset", {{"offset", 0.5f}}}));
    REQUIRE(engine.model().addNode(registry, {"lfo", "mod.lfo", {{"rate", 20.f}, {"depth", 0.25f}}}));
    REQUIRE(engine.model().addNode(registry, {"vca", "amp.vca", {{"gain", 1.f}}}));
    REQUIRE(engine.model().addNode(registry, {"meter", "display.meter", {}}));
    // A module that draws its own picture and has a knob something modulates: both channels at once.
    REQUIRE(engine.model().addNode(registry, {"pattern", "notes.pattern", {{"legato", 0.5f}}}));
    REQUIRE(engine.model().addNode(registry, {"out", "io.audioOut", {}}));
    REQUIRE(engine.model().addEdge(registry, {"e1", "src", "out", "vca", "in"}));
    REQUIRE(engine.model().addEdge(registry, {"e2", "lfo", "out", "vca", "param:gain"}));
    REQUIRE(engine.model().addEdge(registry, {"e3", "vca", "out", "meter", "in"}));
    REQUIRE(engine.model().addEdge(registry, {"e4", "vca", "out", "out", "inL"}));
    REQUIRE(engine.model().addEdge(registry, {"e5", "lfo", "out", "pattern", "param:legato"}));
    REQUIRE(engine.commit());
  }

  void render(uint32_t blocks = 1) {
    float* planar[2] = {left.data(), right.data()};
    TransportSnapshot t;
    for (uint32_t i = 0; i < blocks; ++i) engine.renderBlock(planar, 2, 64, t);
  }
};

}  // namespace

TEST_CASE("a subscribed module publishes the parameter values it actually used", "[telemetry][params]") {
  Rig rig{"values"};
  REQUIRE(rig.engine.setSlot("vca", TelemetryChannel::Params, 0));
  rig.render();

  const TelemetrySlotHeader* slot = rig.writer.slot(0);
  REQUIRE(slot->kind == static_cast<uint32_t>(TelemetryKind::Params));
  REQUIRE(slot->channels == 2);   // amp.vca has two params: gain and curve, in descriptor order
  REQUIRE(slot->seq.load() % 2 == 0);

  // Gain is the knob (1.0) plus the LFO, in display units: inside the param's range and, since the LFO
  // is a quarter of the range either side, never exactly the knob for long.
  const float gain = rig.writer.payload(0)[0];
  REQUIRE(gain >= 0.f);
  REQUIRE(gain <= 2.f);
  // Curve is unmodulated: exactly its default.
  REQUIRE(rig.writer.payload(0)[1] == 0.f);

  // At 20 Hz the LFO moves a good way inside one block of 64 frames, and further across several, so
  // the published value changes from block to block. A slot that published the knob would not.
  std::vector<float> seen;
  for (int b = 0; b < 8; ++b) {
    rig.render();
    seen.push_back(rig.writer.payload(0)[0]);
  }
  bool moved = false;
  for (float v : seen) moved = moved || v != seen[0];
  REQUIRE(moved);
  for (float v : seen) REQUIRE(v != Catch::Approx(1.f).margin(1e-4));
}

TEST_CASE("a module nobody subscribed publishes nothing", "[telemetry][params]") {
  Rig rig{"unsub"};
  rig.render(4);
  for (uint32_t i = 0; i < 8; ++i) REQUIRE(rig.writer.slot(i)->seq.load() == 0);
}

TEST_CASE("a module that draws itself publishes its own kind AND its parameters", "[telemetry][params]") {
  Rig rig{"display"};
  // Two channels of one module, two slots. Sharing one would make the picture and the knobs exclusive,
  // and the knobs would be the ones to lose: a pattern's Legato could never turn under modulation.
  REQUIRE(rig.engine.setSlot("pattern", TelemetryChannel::Display, 1));
  REQUIRE(rig.engine.setSlot("pattern", TelemetryChannel::Params, 2));
  rig.render();

  REQUIRE(rig.writer.slot(1)->kind == static_cast<uint32_t>(TelemetryKind::Notes));
  REQUIRE(rig.writer.slot(2)->kind == static_cast<uint32_t>(TelemetryKind::Params));

  // Legato is the knob (0.5) plus the LFO, and moves; the pattern's other params sit at their defaults.
  const uint32_t legato = 1;   // notes.pattern's params: cycle, legato, transpose, gain
  std::vector<float> seen;
  for (int b = 0; b < 8; ++b) {
    rig.render();
    seen.push_back(rig.writer.payload(2)[legato]);
  }
  bool moved = false;
  for (float v : seen) moved = moved || v != seen[0];
  REQUIRE(moved);
  // And the picture kept coming while the knobs did: one channel does not cost the other.
  REQUIRE(rig.writer.slot(1)->blockIndex > 0);
}

TEST_CASE("a module publishes nothing on a channel nobody asked for", "[telemetry][params]") {
  Rig rig{"onechannel"};
  REQUIRE(rig.engine.setSlot("pattern", TelemetryChannel::Display, 1));
  rig.render(2);
  REQUIRE(rig.writer.slot(1)->kind == static_cast<uint32_t>(TelemetryKind::Notes));
  REQUIRE(rig.writer.slot(2)->seq.load() == 0);
}

TEST_CASE("the block index in a params slot advances with the render", "[telemetry][params]") {
  Rig rig{"block"};
  REQUIRE(rig.engine.setSlot("vca", TelemetryChannel::Params, 2));
  rig.render();
  const uint64_t first = rig.writer.slot(2)->blockIndex;
  rig.render(3);
  REQUIRE(rig.writer.slot(2)->blockIndex == first + 3);
}

TEST_CASE("publishing parameter values allocates nothing", "[telemetry][params][rt]") {
  Rig rig{"rt"};
  REQUIRE(rig.engine.setSlot("vca", TelemetryChannel::Params, 0));
  rig.render();
  REQUIRE(rig.writer.slot(0)->seq.load() > 0);   // proven live before measuring
  {
    pg::test::RtScope rt;
    rig.render(200);
  }
  REQUIRE(rig.writer.slot(0)->seq.load() > 200);
}

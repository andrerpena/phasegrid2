#include <unistd.h>

#include <atomic>
#include <catch2/catch_test_macros.hpp>
#include <catch2/matchers/catch_matchers_floating_point.hpp>
#include <string>
#include <vector>

#include "core/Engine.hpp"
#include "modules/builtin.hpp"
#include "services/Telemetry.hpp"
#include "util/RtGuard.hpp"

using namespace pg;
using Catch::Matchers::WithinAbs;

namespace {

std::string uniqueName(const char* tag) {
  static std::atomic<int> counter{0};
  return std::string("/pg-disp-") + tag + "-" + std::to_string(getpid()) + "-" +
         std::to_string(counter.fetch_add(1));
}

/// A patch that holds a constant and shows it on a meter, plus enough of an output to render.
struct Rig {
  Registry registry;
  Engine engine{registry, EngineConfig{48000.0, 64}};
  TelemetryWriter writer;
  std::vector<float> left = std::vector<float>(64), right = std::vector<float>(64);

  explicit Rig(const char* tag, float value, uint32_t voiceCount = 1) {
    registerBuiltinModules(registry);
    std::string error;
    REQUIRE(writer.create(uniqueName(tag), 4, 48000.0, 64, error));
    engine.setTelemetry(&writer);

    REQUIRE(engine.model().setVoiceCount(voiceCount));
    REQUIRE(engine.model().addNode(registry, {"src", "math.scaleOffset", {{"offset", value}}}));
    REQUIRE(engine.model().addNode(registry, {"meter", "display.meter", {}}));
    REQUIRE(engine.model().addNode(registry, {"out", "io.audioOut", {}}));
    REQUIRE(engine.model().addEdge(registry, {"e1", "src", "out", "meter", "in"}));
    REQUIRE(engine.model().addEdge(registry, {"e2", "src", "out", "out", "inL"}));
    REQUIRE(engine.commit());
  }

  void render(uint32_t blocks = 1) {
    float* planar[2] = {left.data(), right.data()};
    TransportSnapshot t;
    for (uint32_t i = 0; i < blocks; ++i) engine.renderBlock(planar, 2, 64, t);
  }
};

}  // namespace

TEST_CASE("a meter publishes only once someone subscribes", "[display]") {
  Rig rig{"unsub", 0.5f};

  rig.render();
  // Nothing has subscribed, so the slot must still be untouched: an unwatched display module is inert.
  REQUIRE(rig.writer.slot(0)->seq.load() == 0);
  REQUIRE(rig.writer.slot(0)->kind == static_cast<uint32_t>(TelemetryKind::None));

  REQUIRE(rig.engine.setTelemetrySlot("meter", 0));
  rig.render();
  REQUIRE(rig.writer.slot(0)->seq.load() > 0);
  REQUIRE(rig.writer.slot(0)->kind == static_cast<uint32_t>(TelemetryKind::Meter));
}

TEST_CASE("a meter reports the level actually on the wire", "[display]") {
  Rig rig{"level", 0.5f};
  REQUIRE(rig.engine.setTelemetrySlot("meter", 2));
  rig.render();

  const float* p = rig.writer.payload(2);
  // A constant 0.5 on both channels: peak and RMS are both exactly 0.5, and nothing clipped.
  REQUIRE_THAT(p[0], WithinAbs(0.5f, 1e-6f));
  REQUIRE_THAT(p[1], WithinAbs(0.5f, 1e-6f));
  REQUIRE(p[2] == 0.f);
  REQUIRE_THAT(p[3], WithinAbs(0.5f, 1e-6f));
}

TEST_CASE("a meter reads the same on the hundredth block as on the first", "[display]") {
  // The fold accumulates into scratch that must be cleared at the start of every block. Without the
  // clear a meter climbs forever, which no single-block test can see: the level is right the first time
  // and wrong from then on.
  Rig rig{"repeat", 0.5f};
  REQUIRE(rig.engine.setTelemetrySlot("meter", 0));
  rig.render();
  REQUIRE_THAT(rig.writer.payload(0)[0], WithinAbs(0.5f, 1e-6f));

  rig.render(100);
  REQUIRE_THAT(rig.writer.payload(0)[0], WithinAbs(0.5f, 1e-6f));
}

TEST_CASE("a meter sums every voice, not just the first pair", "[display]") {
  // Three voices of 0.5 each. A meter that published from pair 0 alone would report 1.0; the whole
  // patch is 1.5, and that difference is the entire point of accumulating across pairs.
  Rig rig{"poly", 0.5f, 3};
  REQUIRE(rig.engine.setTelemetrySlot("meter", 0));
  rig.render();

  const float* p = rig.writer.payload(0);
  REQUIRE_THAT(p[0], WithinAbs(1.5f, 1e-5f));
}

TEST_CASE("unsubscribing stops a meter publishing", "[display]") {
  Rig rig{"resub", 0.25f};
  REQUIRE(rig.engine.setTelemetrySlot("meter", 1));
  rig.render();
  const uint32_t after = rig.writer.slot(1)->seq.load();
  REQUIRE(after > 0);

  REQUIRE(rig.engine.setTelemetrySlot("meter", kNoTelemetrySlot));
  rig.render(4);
  // The counter must be exactly where it was: a stopped subscription writes nothing at all.
  REQUIRE(rig.writer.slot(1)->seq.load() == after);
}

TEST_CASE("subscribing a module that is not in the patch is refused", "[display]") {
  Rig rig{"missing", 0.25f};
  REQUIRE_FALSE(rig.engine.setTelemetrySlot("nosuchmodule", 0));
}

TEST_CASE("a scope publishes the waveform rather than a level", "[display]") {
  Registry registry;
  registerBuiltinModules(registry);
  Engine engine{registry, EngineConfig{48000.0, 64}};
  TelemetryWriter writer;
  std::string error;
  REQUIRE(writer.create(uniqueName("scope"), 2, 48000.0, 64, error));
  engine.setTelemetry(&writer);

  REQUIRE(engine.model().addNode(registry, {"src", "math.scaleOffset", {{"offset", -0.75f}}}));
  REQUIRE(engine.model().addNode(registry, {"scope", "display.scope", {}}));
  REQUIRE(engine.model().addEdge(registry, {"e1", "src", "out", "scope", "in"}));
  REQUIRE(engine.commit());
  REQUIRE(engine.setTelemetrySlot("scope", 0));

  std::vector<float> l(64), r(64);
  float* planar[2] = {l.data(), r.data()};
  TransportSnapshot t;
  engine.renderBlock(planar, 2, 64, t);

  REQUIRE(writer.slot(0)->kind == static_cast<uint32_t>(TelemetryKind::Scope));
  REQUIRE(writer.slot(0)->frames == 64);
  const float* p = writer.payload(0);
  REQUIRE_THAT(p[0], WithinAbs(-0.75f, 1e-6f));
  REQUIRE_THAT(p[63], WithinAbs(-0.75f, 1e-6f));
  REQUIRE_THAT(p[kTelemetryScopeFrames], WithinAbs(-0.75f, 1e-6f));   // right channel
}

TEST_CASE("a subscribed display module allocates nothing while rendering", "[display][rt]") {
  Rig rig{"rt", 0.5f};
  REQUIRE(rig.engine.setTelemetrySlot("meter", 0));
  rig.render();
  // Prove there is something being published before measuring that publishing costs no allocation.
  REQUIRE(rig.writer.slot(0)->seq.load() > 0);

  {
    pg::test::RtScope rt;
    rig.render(200);
  }
  REQUIRE(rig.writer.slot(0)->seq.load() > 200);
}

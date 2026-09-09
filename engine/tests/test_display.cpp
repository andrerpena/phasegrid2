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

TEST_CASE("a meter holds a peak so a reader at frame rate cannot miss it", "[display]") {
  // The reason the ballistics are in the module. A transient lasts a block; an interface reads one
  // block in six. A peak computed per block and thrown away is a peak nobody ever sees.
  Rig rig{"hold", 0.8f};
  REQUIRE(rig.engine.setTelemetrySlot("meter", 0));
  rig.render();
  REQUIRE_THAT(rig.writer.payload(0)[0], WithinAbs(0.8f, 1e-5f));

  // Silence, well past the parameter's own smoothing, so the wire is certainly at zero.
  REQUIRE(rig.engine.setParam("src", "offset", 0.f));
  rig.render(30);
  const float held = rig.writer.payload(0)[0];
  // A meter that simply reported the block would read zero here. This one is still showing what it saw.
  REQUIRE(held > 0.05f);
  rig.render(10);
  REQUIRE(rig.writer.payload(0)[0] < held);   // and it is on its way down, not stuck

  // At 20 dB a second it reaches the floor within a couple of seconds.
  rig.render(1200);
  REQUIRE(rig.writer.payload(0)[0] < 0.05f);
}

TEST_CASE("a meter latches a clip so a reader cannot miss it either", "[display]") {
  // Clipping is the one thing a meter exists to report and it can last a single sample.
  // Three voices, so the patch can be pushed past full scale: the offset alone tops out at 1.0, and
  // it is the sum at the output that clips, which is the thing being metered.
  Rig rig{"clip", 0.2f, 3};
  REQUIRE(rig.engine.setTelemetrySlot("meter", 0));
  rig.render();
  REQUIRE(rig.writer.payload(0)[2] == 0.f);

  REQUIRE(rig.engine.setParam("src", "offset", 0.5f));
  rig.render(30);
  REQUIRE(rig.writer.payload(0)[2] == 1.f);

  // Back under full scale: the light stays on for a moment, then goes out.
  REQUIRE(rig.engine.setParam("src", "offset", 0.1f));
  rig.render(30);
  REQUIRE(rig.writer.payload(0)[2] == 1.f);
  rig.render(1500);
  REQUIRE(rig.writer.payload(0)[2] == 0.f);
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

/// A scope on a source, with the scope's `time` set. Renders 64-frame blocks at 48 kHz.
struct ScopeRig {
  Registry registry;
  Engine engine{registry, EngineConfig{48000.0, 64}};
  TelemetryWriter writer;
  std::vector<float> left = std::vector<float>(64), right = std::vector<float>(64);

  ScopeRig(const char* tag, const NodeModel& source, float timeMs) {
    registerBuiltinModules(registry);
    std::string error;
    REQUIRE(writer.create(uniqueName(tag), 2, 48000.0, 64, error));
    engine.setTelemetry(&writer);
    REQUIRE(engine.model().addNode(registry, source));
    REQUIRE(engine.model().addNode(registry, {"scope", "display.scope", {{"time", timeMs}}}));
    REQUIRE(engine.model().addEdge(registry, {"e1", source.id, "out", "scope", "in"}));
    REQUIRE(engine.commit());
    REQUIRE(engine.setTelemetrySlot("scope", 0));
  }

  void render(uint32_t blocks = 1) {
    float* planar[2] = {left.data(), right.data()};
    TransportSnapshot t;
    for (uint32_t i = 0; i < blocks; ++i) engine.renderBlock(planar, 2, 64, t);
  }

  /// Rising zero crossings in the left channel of the published window: cycles on the screen.
  uint32_t risingCrossings() {
    const float* p = writer.payload(0);
    const uint32_t n = writer.slot(0)->frames;
    uint32_t count = 0;
    for (uint32_t i = 1; i < n; ++i)
      if (p[i - 1] < 0.f && p[i] >= 0.f) ++count;
    return count;
  }
};

TEST_CASE("a scope publishes the waveform rather than a level", "[display]") {
  ScopeRig rig{"scope", {"src", "math.scaleOffset", {{"offset", -0.75f}}}, 20.f};
  rig.render();

  REQUIRE(rig.writer.slot(0)->kind == static_cast<uint32_t>(TelemetryKind::Scope));
  // At 20 ms the window is 1024 samples at 48 kHz, so nothing is decimated and one block is 64 frames.
  REQUIRE(rig.writer.slot(0)->frames == 64);
  const float* p = rig.writer.payload(0);
  REQUIRE_THAT(p[0], WithinAbs(-0.75f, 1e-6f));
  REQUIRE_THAT(p[63], WithinAbs(-0.75f, 1e-6f));
  REQUIRE_THAT(p[kTelemetryScopeFrames], WithinAbs(-0.75f, 1e-6f));   // right channel
}

TEST_CASE("a scope keeps a window longer than a block and publishes the whole of it", "[display]") {
  // A block is 64 frames; the window is 1024. A reader at frame rate sees one block in six, so a scope
  // that published a block at a time would hand it a picture that is mostly holes.
  ScopeRig rig{"window", {"src", "math.scaleOffset", {{"offset", 0.5f}}}, 20.f};
  rig.render(8);
  REQUIRE(rig.writer.slot(0)->frames == 512);
  rig.render(8);
  REQUIRE(rig.writer.slot(0)->frames == kTelemetryScopeFrames);
  rig.render(100);
  // Full stays full, and every frame of it is the signal: the ring wrapped many times without a seam.
  REQUIRE(rig.writer.slot(0)->frames == kTelemetryScopeFrames);
  const float* p = rig.writer.payload(0);
  for (uint32_t i = 0; i < kTelemetryScopeFrames; ++i) REQUIRE(p[i] == 0.5f);
}

TEST_CASE("a scope's window is published oldest frame first", "[display]") {
  // The scope taps the same wire the output carries, so once the ring has wrapped its window must be
  // exactly the last 1024 samples that came out, in the order they came out. A window published in the
  // ring's storage order would match for the first sixteen blocks and then jump in the middle.
  ScopeRig rig{"order", {"src", "osc.sine", {}}, 20.f};
  REQUIRE(rig.engine.model().addNode(rig.registry, {"out", "io.audioOut", {}}));
  REQUIRE(rig.engine.model().addEdge(rig.registry, {"e2", "src", "out", "out", "inL"}));
  REQUIRE(rig.engine.commit());
  REQUIRE(rig.engine.setTelemetrySlot("scope", 0));

  std::vector<float> heard;
  for (int i = 0; i < 40; ++i) {   // well past one full window, so the ring has wrapped
    rig.render();
    heard.insert(heard.end(), rig.left.begin(), rig.left.end());
  }
  const float* p = rig.writer.payload(0);
  const uint32_t n = rig.writer.slot(0)->frames;
  REQUIRE(n == kTelemetryScopeFrames);
  REQUIRE(heard.size() >= n);
  const size_t from = heard.size() - n;
  for (uint32_t i = 0; i < n; ++i) REQUIRE_THAT(p[i], WithinAbs(heard[from + i], 1e-5f));
}

TEST_CASE("a longer time shows more cycles of the same tone", "[display]") {
  // Middle C, 20 ms: about five and a half cycles on the screen. At 100 ms the module keeps one sample
  // in five, so the same window covers ~107 ms and about twenty-eight cycles.
  ScopeRig fast{"time20", {"src", "osc.sine", {}}, 20.f};
  fast.render(40);
  const uint32_t cyclesAt20 = fast.risingCrossings();
  REQUIRE(cyclesAt20 >= 5);
  REQUIRE(cyclesAt20 <= 6);

  ScopeRig slow{"time100", {"src", "osc.sine", {}}, 100.f};
  slow.render(120);
  const uint32_t cyclesAt100 = slow.risingCrossings();
  REQUIRE(cyclesAt100 >= 26);
  REQUIRE(cyclesAt100 <= 29);
}

TEST_CASE("changing the time starts the window over", "[display]") {
  // Half a window at one timescale and half at another would read as a signal that changed shape.
  ScopeRig rig{"retime", {"src", "math.scaleOffset", {{"offset", 0.5f}}}, 20.f};
  rig.render(20);
  REQUIRE(rig.writer.slot(0)->frames == kTelemetryScopeFrames);

  REQUIRE(rig.engine.setParam("scope", "time", 100.f));
  rig.render();
  // One block of 64 at a stride of 5 keeps thirteen samples, and nothing of the old window.
  REQUIRE(rig.writer.slot(0)->frames == 13);
}

TEST_CASE("a readout publishes the signed value on the wire, not its magnitude", "[display]") {
  // The reason `Value` is its own kind. A meter would report 0.75 for this and for +0.75 alike, and a
  // control voltage's sign is most of what a readout is read for.
  Registry registry;
  registerBuiltinModules(registry);
  Engine engine{registry, EngineConfig{48000.0, 64}};
  TelemetryWriter writer;
  std::string error;
  REQUIRE(writer.create(uniqueName("value"), 2, 48000.0, 64, error));
  engine.setTelemetry(&writer);

  REQUIRE(engine.model().addNode(registry, {"src", "math.scaleOffset", {{"offset", -0.75f}}}));
  REQUIRE(engine.model().addNode(registry, {"readout", "display.value", {}}));
  REQUIRE(engine.model().addEdge(registry, {"e1", "src", "out", "readout", "in"}));
  REQUIRE(engine.commit());

  std::vector<float> l(64), r(64);
  float* planar[2] = {l.data(), r.data()};
  TransportSnapshot t;
  engine.renderBlock(planar, 2, 64, t);
  // Nobody watching: a readout is as inert as a meter.
  REQUIRE(writer.slot(0)->seq.load() == 0);

  REQUIRE(engine.setTelemetrySlot("readout", 0));
  engine.renderBlock(planar, 2, 64, t);
  REQUIRE(writer.slot(0)->kind == static_cast<uint32_t>(TelemetryKind::Value));
  REQUIRE(writer.slot(0)->channels == 2);
  REQUIRE(writer.slot(0)->frames == 1);
  REQUIRE_THAT(writer.payload(0)[0], WithinAbs(-0.75f, 1e-6f));
  REQUIRE_THAT(writer.payload(0)[1], WithinAbs(-0.75f, 1e-6f));
}

TEST_CASE("a readout reads the end of the block, and every voice of it", "[display]") {
  // Three voices of the same constant sum, as they do at the output and on the meter.
  Registry registry;
  registerBuiltinModules(registry);
  Engine engine{registry, EngineConfig{48000.0, 64}};
  TelemetryWriter writer;
  std::string error;
  REQUIRE(writer.create(uniqueName("valpoly"), 2, 48000.0, 64, error));
  engine.setTelemetry(&writer);

  REQUIRE(engine.model().setVoiceCount(3));
  REQUIRE(engine.model().addNode(registry, {"src", "math.scaleOffset", {{"offset", 0.25f}}}));
  REQUIRE(engine.model().addNode(registry, {"readout", "display.value", {}}));
  REQUIRE(engine.model().addEdge(registry, {"e1", "src", "out", "readout", "in"}));
  REQUIRE(engine.commit());
  REQUIRE(engine.setTelemetrySlot("readout", 1));

  std::vector<float> l(64), r(64);
  float* planar[2] = {l.data(), r.data()};
  TransportSnapshot t;
  engine.renderBlock(planar, 2, 64, t);
  REQUIRE_THAT(writer.payload(1)[0], WithinAbs(0.75f, 1e-5f));

  // A moving signal: what the readout publishes is exactly the last frame the engine produced, which
  // is the claim worth pinning. A readout that took the block's first frame, or its average, passes
  // every constant test and fails this one.
  Engine moving{registry, EngineConfig{48000.0, 64}};
  TelemetryWriter w2;
  REQUIRE(w2.create(uniqueName("valtone"), 2, 48000.0, 64, error));
  moving.setTelemetry(&w2);
  REQUIRE(moving.model().addNode(registry, {"tone", "osc.sine", {}}));
  REQUIRE(moving.model().addNode(registry, {"readout", "display.value", {}}));
  REQUIRE(moving.model().addNode(registry, {"out", "io.audioOut", {}}));
  REQUIRE(moving.model().addEdge(registry, {"e1", "tone", "out", "readout", "in"}));
  REQUIRE(moving.model().addEdge(registry, {"e2", "tone", "out", "out", "inL"}));
  REQUIRE(moving.commit());
  REQUIRE(moving.setTelemetrySlot("readout", 0));

  float last = 0.f;
  for (int i = 0; i < 5; ++i) {
    moving.renderBlock(planar, 2, 64, t);
    REQUIRE_THAT(w2.payload(0)[0], WithinAbs(l[63], 1e-5f));
    if (i > 0) REQUIRE(w2.payload(0)[0] != last);   // and it is a signal, not a stuck reading
    last = w2.payload(0)[0];
  }
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

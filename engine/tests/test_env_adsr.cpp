#include <unistd.h>

#include <atomic>
#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <cmath>
#include <map>
#include <memory>
#include <nlohmann/json.hpp>
#include <string>

#include "core/Engine.hpp"
#include "core/Module.hpp"
#include "modules/builtin.hpp"
#include "services/PreviewPublisher.hpp"
#include "services/Telemetry.hpp"
#include "util/GraphFixture.hpp"
#include "util/RtGuard.hpp"

/**
 * `env.adsr`: the four-stage envelope, and the two things about it that are easy to get wrong.
 *
 * The first is UNITS. Its predecessor published the vendored library's own control range as seconds
 * when it was the fourth root of seconds, so an Attack of 0.15 meant half a millisecond. Several tests
 * here measure a stage against the clock rather than against another setting, because "a bigger number
 * is slower" passes just as well when the number means nothing.
 *
 * The second is that it is a signal path as well as a modulator: Signal In comes back out of Signal
 * Out with the envelope applied, and Bias Out is the envelope less its sustain.
 */

namespace {

constexpr uint32_t kBlock = 64;
constexpr double kRate = 48000.0;
/// Blocks in a second, at the rate and block size every rig here uses.
constexpr int kBlocksPerSecond = static_cast<int>(kRate) / static_cast<int>(kBlock);

enum Model : int { kAnalog = 0, kRelative = 1, kDigital = 2 };

/// A gate into the envelope, with a constant signal through its signal path, read straight off its
/// outputs. The gate is an edge between two constant nodes so it can be dropped: swapping the edge and
/// recompiling keeps the same envelope instance (nothing structural changed), which is what makes the
/// release observable.
struct Rig {
  pg::test::GraphFixture f;
  std::unique_ptr<pg::Program> program;

  explicit Rig(std::map<std::string, float> params, float signal = 1.f) {
    pg::registerBuiltinModules(f.reg);
    f.node("hi", "test.const", {{"value", 1.f}});
    f.node("lo", "test.const", {{"value", 0.f}});
    f.node("sig", "test.const", {{"value", signal}});
    f.node("env", "env.adsr", std::move(params));
    f.edge("gate", "hi.out", "env.gate");
    f.edge("in", "sig.out", "env.signal");
    program = f.compile(kRate, kBlock);
  }
  /// The fixture does not advance the transport; a test that plays notes must, or every module that
  /// derives its position from the clock sees the same instant for ever and replays it.
  uint64_t block = 0;
  void run(int blocks = 1) {
    for (int i = 0; i < blocks; ++i) {
      f.transport.samplePos = kBlock * block++;
      f.run(*program, kBlock);
    }
  }
  void releaseGate() {
    REQUIRE(f.model.removeEdge("gate"));
    f.edge("gate", "lo.out", "env.gate");
    program = f.compile(kRate, kBlock);
  }
  float env(uint32_t frame = kBlock - 1) { return f.out(*program, "env", "env", frame); }
  float signal(uint32_t frame = kBlock - 1) { return f.out(*program, "env", "signal", frame); }
  float bias(uint32_t frame = kBlock - 1) { return f.out(*program, "env", "bias", frame); }
  /// Blocks until the envelope first reaches `level`, capped so a stuck envelope fails rather than hangs.
  int blocksUntil(float level, int cap = 20 * kBlocksPerSecond) {
    for (int b = 0; b < cap; ++b) {
      run();
      if (env() >= level) return b + 1;
    }
    return cap;
  }
};

/// Everything at zero but the sustain: the envelope is a gate follower, which is the baseline the
/// other cases change one knob from.
const std::map<std::string, float> kInstant = {
  {"attack", 0.f}, {"decay", 0.f}, {"sustain", 100.f}, {"release", 0.f}, {"model", kDigital}};

std::map<std::string, float> with(std::map<std::string, float> base, const char* id, float value) {
  base[id] = value;
  return base;
}

std::string uniqueName(const char* tag) {
  static std::atomic<int> counter{0};
  return std::string("/pg-adsr-") + tag + "-" + std::to_string(getpid()) + "-" +
         std::to_string(counter.fetch_add(1));
}

}  // namespace

// ------------------------------------------------------------------------------------ the surface

TEST_CASE("env.adsr declares the reference instrument's ports and ranges", "[env]") {
  pg::Registry reg;
  pg::registerBuiltinModules(reg);
  const pg::RegisteredModule* e = reg.find("env.adsr");
  REQUIRE(e != nullptr);
  REQUIRE(e->findInput("signal") == 0);
  REQUIRE(e->findInput("gate") == 1);
  REQUIRE(e->findOutput("signal") == 0);
  REQUIRE(e->findOutput("env") == 1);
  REQUIRE(e->findOutput("bias") == 2);

  // The times are in seconds and reach the reference's eight, on a taper that leaves most of the knob
  // under a second. A range of 0..2.378 here would be the bug this module was written to end.
  for (const char* id : {"attack", "decay", "release"}) {
    const pg::ParamDesc& p = e->desc->params[static_cast<uint32_t>(e->findParam(id))];
    REQUIRE(p.min == Catch::Approx(0.f));
    REQUIRE(p.max == Catch::Approx(8.f));
    REQUIRE(p.unit == pg::ParamUnit::Seconds);
    REQUIRE(p.curve == pg::ParamCurve::Quartic);
    REQUIRE((p.flags & pg::kParamModulatable) != 0);
    REQUIRE(e->findInput((std::string("param:") + id).c_str()) >= 0);
  }
  const pg::ParamDesc& sustain = e->desc->params[static_cast<uint32_t>(e->findParam("sustain"))];
  REQUIRE(sustain.max == Catch::Approx(100.f));
  REQUIRE(sustain.unit == pg::ParamUnit::Percent);

  const pg::ParamDesc& model = e->desc->params[static_cast<uint32_t>(e->findParam("model"))];
  REQUIRE((model.flags & pg::kParamEnum) != 0);
  REQUIRE(model.enumCount == 3);
  REQUIRE((e->desc->flags & pg::kModulePreviewsEnvelope) != 0);
}

// ------------------------------------------------------------------------------------- the stages

TEST_CASE("env.adsr rises on the gate and releases when it drops", "[env]") {
  Rig rig(kInstant);
  rig.run();
  REQUIRE(rig.env() == Catch::Approx(1.f).margin(0.02f));

  rig.releaseGate();
  rig.run();
  REQUIRE(rig.env() == Catch::Approx(0.f).margin(0.02f));
}

TEST_CASE("env.adsr's attack knob is in seconds", "[env]") {
  // The test the units bug would have failed. A quarter-second attack is a quarter second: not a
  // quarter of a knob, not the fourth power of anything.
  Rig rig(with(kInstant, "attack", 0.25f));
  const int blocks = rig.blocksUntil(0.999f);
  REQUIRE(blocks > kBlocksPerSecond / 5);        // 0.2 s: it has not arrived early
  REQUIRE(blocks < kBlocksPerSecond * 3 / 10);   // 0.3 s: nor late
  // And half way through it is half way up, because Digital draws a straight line.
  Rig half(with(kInstant, "attack", 0.25f));
  half.run(kBlocksPerSecond / 8);
  REQUIRE(half.env() == Catch::Approx(0.5f).margin(0.05f));
}

TEST_CASE("env.adsr decays to the sustain level and holds there", "[env]") {
  Rig rig(with(with(kInstant, "decay", 0.1f), "sustain", 50.f));
  rig.run(kBlocksPerSecond / 4);   // a quarter second: well past the decay
  REQUIRE(rig.env() == Catch::Approx(0.5f).margin(0.02f));
  rig.run(kBlocksPerSecond);
  REQUIRE(rig.env() == Catch::Approx(0.5f).margin(0.02f));   // and it stays while the gate is high
}

TEST_CASE("env.adsr's release is measured from the level the note ended at", "[env]") {
  Rig rig(with(with(with(kInstant, "sustain", 100.f), "release", 0.2f), "model", kDigital));
  rig.run(4);
  REQUIRE(rig.env() > 0.99f);
  rig.releaseGate();
  // Half of a 0.2 s release from full scale is half way down.
  rig.run(kBlocksPerSecond / 10);
  REQUIRE(rig.env() == Catch::Approx(0.5f).margin(0.06f));
  rig.run(kBlocksPerSecond / 10 + 4);
  REQUIRE(rig.env() == Catch::Approx(0.f).margin(0.02f));
}

// -------------------------------------------------------------------------------------- the models

TEST_CASE("Digital is straight lines and Analog is curved", "[env]") {
  Rig digital(with(with(kInstant, "attack", 0.2f), "model", kDigital));
  Rig analog(with(with(kInstant, "attack", 0.2f), "model", kAnalog));
  digital.run(kBlocksPerSecond / 10);   // half way through the attack
  analog.run(kBlocksPerSecond / 10);
  REQUIRE(digital.env() == Catch::Approx(0.5f).margin(0.05f));
  // The set curve moves fast and then eases, the way a capacitor charges, so at the half way point it
  // is well past half way up.
  REQUIRE(analog.env() > 0.6f);
}

TEST_CASE("Relative measures each stage as a rate, so a shorter move takes less time", "[env]") {
  // Two envelopes with the same one-second release, released from different levels. Under Digital the
  // knob is the time whatever the distance; under Relative it is the time to cross the WHOLE range, so
  // falling from half scale takes half as long.
  auto releaseFrom = [](float sustainPercent, int model) {
    Rig rig(with(with(with(kInstant, "sustain", sustainPercent), "release", 1.f), "model", model));
    rig.run(8);
    rig.releaseGate();
    for (int b = 0; b < 4 * kBlocksPerSecond; ++b) {
      rig.run();
      if (rig.env() <= 0.001f) return b + 1;
    }
    return 4 * kBlocksPerSecond;
  };
  const int digitalFull = releaseFrom(100.f, kDigital);
  const int digitalHalf = releaseFrom(50.f, kDigital);
  REQUIRE(digitalHalf == Catch::Approx(digitalFull).margin(kBlocksPerSecond / 20));

  const int relativeFull = releaseFrom(100.f, kRelative);
  const int relativeHalf = releaseFrom(50.f, kRelative);
  REQUIRE(relativeHalf < relativeFull * 3 / 4);
}

// ------------------------------------------------------------------------------- the signal path

TEST_CASE("env.adsr applies the envelope to the signal it is given", "[env]") {
  Rig rig(with(with(kInstant, "sustain", 50.f), "model", kDigital), /*signal=*/0.8f);
  rig.run(4);
  REQUIRE(rig.env() == Catch::Approx(0.5f).margin(0.02f));
  REQUIRE(rig.signal() == Catch::Approx(0.8f * 0.5f).margin(0.02f));

  // Analog's amplifier is not linear: the same envelope at half scale passes a quarter of the signal,
  // which is the curve `amp.vca`'s Exponential uses and what makes a fade sound even.
  Rig analog(with(with(kInstant, "sustain", 50.f), "model", kAnalog), /*signal=*/0.8f);
  analog.run(4);
  REQUIRE(analog.signal() == Catch::Approx(0.8f * 0.25f).margin(0.02f));
}

TEST_CASE("env.adsr's bias output rests at zero while a note is held", "[env]") {
  Rig rig(with(with(kInstant, "sustain", 75.f), "decay", 0.05f));
  rig.run(kBlocksPerSecond / 4);
  REQUIRE(rig.env() == Catch::Approx(0.75f).margin(0.02f));
  REQUIRE(rig.bias() == Catch::Approx(0.f).margin(0.02f));
  // And it swings to -sustain once the envelope is back at zero: -0.75 to +0.25, as the reference says.
  rig.releaseGate();
  rig.run(4);
  REQUIRE(rig.bias() == Catch::Approx(-0.75f).margin(0.02f));
}

TEST_CASE("env.adsr with nothing in its signal input puts out silence there", "[env]") {
  pg::test::GraphFixture f;
  pg::registerBuiltinModules(f.reg);
  f.node("hi", "test.const", {{"value", 1.f}});
  f.node("env", "env.adsr", kInstant);
  f.edge("gate", "hi.out", "env.gate");
  auto program = f.compile(kRate, kBlock);
  f.run(*program, kBlock);
  REQUIRE(f.out(*program, "env", "env", kBlock - 1) > 0.9f);
  REQUIRE(f.out(*program, "env", "signal", kBlock - 1) == Catch::Approx(0.f).margin(1e-6f));
}

// ------------------------------------------------------------------------------------ the picture

TEST_CASE("env.adsr draws its own shape", "[env]") {
  pg::Registry registry;
  pg::registerBuiltinModules(registry);
  pg::Engine engine{registry, pg::EngineConfig{kRate, kBlock}};
  pg::TelemetryWriter writer;
  std::string error;
  REQUIRE(writer.create(uniqueName("picture"), 8, kRate, kBlock, error));
  engine.setTelemetry(&writer);
  REQUIRE(engine.model().addNode(registry, {"env", "env.adsr",
    {{"attack", 1.f}, {"decay", 1.f}, {"sustain", 50.f}, {"release", 2.f}, {"model", kDigital}}}));
  REQUIRE(engine.commit());

  pg::PreviewPublisher publisher{engine, writer};
  REQUIRE(engine.setSlot("env", pg::TelemetryChannel::Preview, 0));
  publisher.tick();

  const pg::TelemetrySlotHeader* slot = writer.slot(0);
  REQUIRE(slot->kind == static_cast<uint32_t>(pg::TelemetryKind::Envelope));
  REQUIRE(slot->frames == pg::kPreviewFrames);
  const float* picture = writer.payload(0);

  // The stages share three quarters of the width in proportion to their times -- 1 s, 1 s and 2 s --
  // and the sustain plateau is the remaining quarter.
  REQUIRE(picture[pg::kEnvelopeAttackEnd] == Catch::Approx(0.1875f).margin(0.001f));
  REQUIRE(picture[pg::kEnvelopeDecayEnd] == Catch::Approx(0.375f).margin(0.001f));
  REQUIRE(picture[pg::kEnvelopeSustainEnd] == Catch::Approx(0.625f).margin(0.001f));
  REQUIRE(picture[pg::kEnvelopeSustainLevel] == Catch::Approx(0.5f));
  REQUIRE(picture[pg::kEnvelopePlayheadX] == -1.f);   // nothing has played it yet

  // The curve itself: up to full scale at the attack's end, down to the sustain, flat across the
  // plateau, and zero once the release is over.
  const float* curve = picture + pg::kEnvelopePictureHeader;
  const uint32_t points = pg::kPreviewFrames - pg::kEnvelopePictureHeader;
  auto at = [&](float x) { return curve[static_cast<uint32_t>(x * static_cast<float>(points - 1))]; };
  REQUIRE(at(0.f) == Catch::Approx(0.f).margin(0.02f));
  REQUIRE(at(0.185f) == Catch::Approx(1.f).margin(0.05f));
  REQUIRE(at(0.5f) == Catch::Approx(0.5f).margin(0.01f));
  REQUIRE(at(1.f) == Catch::Approx(0.f).margin(0.02f));
}

// --------------------------------------------------------------------------- the gate on notes

TEST_CASE("env.adsr with nothing in its Gate follows the note its voice is playing", "[env]") {
  // The patch anyone builds first: a pattern, a converter, an oscillator through the envelope, the
  // output. Nothing is plugged into Gate, because nothing about the module says a cable is missing --
  // and with no answer for that the whole patch is silent, which is a bad way to learn.
  pg::test::GraphFixture f;
  pg::registerBuiltinModules(f.reg);
  f.node("pat", "notes.pattern", {{"legato", 0.5f}, {"cycle", 4.f}});
  REQUIRE(f.model.setNodeData("pat", nlohmann::json{{"pattern", "c3 e3"}}));
  f.node("poly", "note.toPoly", {{"voices", 4.f}});
  f.node("osc", "osc.sine");
  f.node("env", "env.adsr",
         {{"attack", 0.f}, {"decay", 0.f}, {"sustain", 100.f}, {"release", 0.f}, {"model", kDigital}});
  f.node("out", "io.audioOut");
  f.edge("n0", "pat.notes", "poly.notes");
  f.edge("n1", "poly.pitch", "osc.pitch");
  f.edge("e0", "osc.out", "env.signal");
  f.edge("e1", "env.signal", "out.inL");
  auto program = f.compile(kRate, kBlock);

  // Between the notes -- legato 0.5, so the second half of each step is a gap -- the envelope is shut.
  float loudest = 0.f, quietest = 1.f;
  for (uint64_t b = 0; b < 4 * kBlocksPerSecond; ++b) {
    f.transport.samplePos = kBlock * b;
    f.run(*program, kBlock);
    const float level = std::fabs(f.out(*program, "env", "env", kBlock - 1, 0));
    loudest = std::max(loudest, level);
    quietest = std::min(quietest, level);
  }
  REQUIRE(loudest > 0.9f);     // the note opened it
  REQUIRE(quietest < 0.1f);    // and the gap closed it again
}

TEST_CASE("a note that steals a voice retriggers an unconnected Gate", "[env]") {
  // One voice, so every note after the first steals the one that is playing. The voice is held before
  // and after, so its level says nothing happened; only the pool's note count does. Without that this
  // envelope would open once and never move again, which is what a mono lead would sound like.
  pg::test::GraphFixture f;
  pg::registerBuiltinModules(f.reg);
  f.node("pat", "notes.pattern", {{"legato", 1.f}, {"cycle", 4.f}});   // no gaps: every note steals
  REQUIRE(f.model.setNodeData("pat", nlohmann::json{{"pattern", "c3 e3 g3 c4"}}));
  f.node("poly", "note.toPoly", {{"voices", 1.f}});
  // Plucked, so each note is a shape rather than a level: a retrigger at full scale with the sustain
  // at 100% would rightly do nothing at all ("rise time from the CURRENT value to 100%"), and there
  // would be nothing to see.
  f.node("env", "env.adsr",
         {{"attack", 0.05f}, {"decay", 0.1f}, {"sustain", 0.f}, {"release", 0.f}, {"model", kDigital}});
  f.node("osc", "osc.sine");
  f.node("out", "io.audioOut");
  f.edge("n0", "pat.notes", "poly.notes");
  f.edge("n1", "poly.pitch", "osc.pitch");
  f.edge("e0", "osc.out", "env.signal");
  f.edge("e1", "env.signal", "out.inL");
  auto program = f.compile(kRate, kBlock);

  // Two seconds at 120 bpm is two cycles of four notes. Without a retrigger the envelope would pluck
  // ONCE and lie at zero for the rest, so counting the plucks is the whole assertion.
  int plucks = 0;
  bool low = true;
  for (uint64_t b = 0; b < 2 * kBlocksPerSecond; ++b) {
    f.transport.samplePos = kBlock * b;
    f.run(*program, kBlock);
    const float level = f.out(*program, "env", "env", kBlock - 1, 0);
    if (low && level > 0.9f) { ++plucks; low = false; }
    if (level < 0.1f) low = true;
  }
  REQUIRE(plucks >= 4);
}

TEST_CASE("env.adsr outside an instrument reads an unconnected Gate as held", "[env]") {
  // No pool, so no note to follow, and an envelope that stayed shut would make a global one useless
  // as a plain shaper. It opens and stays open.
  pg::test::GraphFixture f;
  pg::registerBuiltinModules(f.reg);
  f.node("sig", "test.const", {{"value", 0.5f}});
  f.node("env", "env.adsr", kInstant);
  f.edge("in", "sig.out", "env.signal");
  auto program = f.compile(kRate, kBlock);
  f.run(*program, kBlock);
  REQUIRE(f.out(*program, "env", "env", kBlock - 1) > 0.9f);
  REQUIRE(f.out(*program, "env", "signal", kBlock - 1) == Catch::Approx(0.5f).margin(0.02f));
}

// ----------------------------------------------------------------------------- the audio thread

TEST_CASE("env.adsr steady state is allocation free", "[env][rt]") {
  Rig rig(with(with(kInstant, "attack", 0.5f), "release", 0.5f));
  rig.run(4);
  REQUIRE(rig.env() > 0.01f);   // it really is running, so the check below is not measuring a dead graph
  pg::test::resetRtViolations();
  { pg::test::RtScope scope; rig.run(200); }
  REQUIRE(pg::test::rtViolations() == 0);
}

TEST_CASE("env.adsr keeps one envelope per voice pair", "[env]") {
  // The scheduler runs the op list once per pair through the same Module, so the pairs must not share
  // a `vital::Envelope`: pair 1's closed gate would otherwise release pair 0's envelope every block.
  pg::test::GraphFixture f;
  pg::registerBuiltinModules(f.reg);
  f.node("pat", "notes.pattern", {{"legato", 1.f}});
  REQUIRE(f.model.setNodeData("pat", nlohmann::json{{"pattern", "[c3,e3,g3,bb3]"}}));
  f.node("poly", "note.toPoly", {{"voices", 4.f}});
  f.node("env", "env.adsr",
         {{"attack", 0.06f}, {"decay", 0.f}, {"sustain", 100.f}, {"release", 0.f}, {"model", kDigital}});
  f.node("osc", "osc.sine");
  f.node("out", "io.audioOut");
  f.edge("n0", "pat.notes", "poly.notes");
  f.edge("n1", "poly.pitch", "osc.pitch");
  f.edge("n2", "poly.gate", "env.gate");
  f.edge("e0", "osc.out", "env.signal");
  f.edge("e1", "env.signal", "out.inL");
  auto program = f.compile(kRate, kBlock);

  f.run(*program, kBlock);
  // Lane 0 is pair 0's first voice and lane 2 its second; both are holding a note of the chord.
  const float early = f.out(*program, "env", "env", kBlock - 1, 0);
  REQUIRE(early > 0.f);
  for (uint64_t i = 1; i <= 120; ++i) {   // 160 ms, well past the 60 ms attack
    f.transport.samplePos = kBlock * i;
    f.run(*program, kBlock);
  }
  REQUIRE(f.out(*program, "env", "env", kBlock - 1, 0) > 0.9f);
  REQUIRE(f.out(*program, "env", "env", kBlock - 1, 2) > 0.9f);
}

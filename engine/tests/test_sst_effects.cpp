#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <cmath>
#include <map>
#include <string>
#include "core/Registry.hpp"
#include "modules/builtin.hpp"
#include "sst/Descriptors.hpp"
#include "util/Fx.hpp"
#include "util/RtGuard.hpp"

using pg::test::Fx;

namespace {

/// Every effect hosted through `engine/src/sst`.
const char* kSstEffects[] = {"fx.reverb", "fx.reverb.hall", "fx.delay",  "fx.delay.floaty",
                             "fx.flanger", "fx.phaser",     "fx.bonsai", "fx.rotary"};

/// A sawtooth rather than a sine: an effect is measured across the spectrum, not at one frequency.
constexpr float kSaw = 6.f;

}  // namespace

TEST_CASE("every sst effect has the same audio-in/audio-out shape", "[sst]") {
  pg::Registry reg;
  pg::registerBuiltinModules(reg);
  for (const char* id : kSstEffects) {
    DYNAMIC_SECTION(id) {
      const pg::RegisteredModule* m = reg.find(id);
      REQUIRE(m != nullptr);
      REQUIRE(m->desc->numInputs == 1);
      REQUIRE(m->findInput("in") == 0);
      REQUIRE(m->findOutput("out") == 0);
      REQUIRE(m->desc->numParams > 0);
      REQUIRE(std::string(m->desc->category) == "Audio FX");
    }
  }
}

TEST_CASE("every sst effect passes audio and is allocation free", "[sst][rt]") {
  for (const char* id : kSstEffects) {
    DYNAMIC_SECTION(id) {
      Fx fx(id, {}, /*sine=*/true, /*level=*/1.f, kSaw);
      fx.run(50);                          // past the first block's ramps
      REQUIRE(fx.rms(100, "src") > 0.5);   // the source really is producing a signal
      REQUIRE(fx.rms(100) > 0.001);        // and the effect really is passing one on
      pg::test::resetRtViolations();
      { pg::test::RtScope scope; fx.run(100); }
      REQUIRE(pg::test::rtViolations() == 0);
    }
  }
}

/**
 * The reason this layer exists.
 *
 * A parameter generated from a vendored table used to carry the vendored library's own pre-scale
 * number under a unit label that did not describe it -- an Attack of 0.15 that meant half a
 * millisecond, a Decay Time of 0 that meant one second (docs/engine.md, docs/adrs/0008). An sst
 * effect describes its parameters properly, and `buildDescriptor` publishes the display range and
 * the taper that reproduces it. So the published range has to agree with what the effect itself
 * would print, and this is where that is checked.
 */
TEST_CASE("a generated param's range is the one the effect would display", "[sst]") {
  pg::Registry reg;
  pg::registerBuiltinModules(reg);
  for (const char* id : kSstEffects) {
    DYNAMIC_SECTION(id) {
      const pg::RegisteredModule* m = reg.find(id);
      REQUIRE(m != nullptr);
      const std::unique_ptr<pg::sstfx::Instance> probe(pg::sstfx::specFor(*m->desc).create());
      REQUIRE(probe != nullptr);

      uint32_t ours = 0;
      for (int i = 0; i < probe->numParams(); ++i) {
        const pg::sstfx::ParamMeta meta = probe->paramAt(i);
        if (!pg::sstfx::publishable(meta)) continue;
        REQUIRE(ours < m->desc->numParams);
        const pg::ParamDesc& p = m->desc->params[ours++];
        INFO(id << " param " << p.id);

        // The names line up, so the wrapper's index map is the same one the generator used.
        REQUIRE(std::string(p.name) == meta.name);
        // The range is a real one, and the default is inside it.
        REQUIRE(p.max > p.min);
        REQUIRE(p.def >= p.min);
        REQUIRE(p.def <= p.max);
        // A logarithmic taper cannot reach zero, and `Param.cpp` divides by the minimum.
        if (p.curve == pg::ParamCurve::Log) REQUIRE(p.min > 0.f);

        // And the ends are what the effect would print for its own extremes. `valueToString` gives
        // a formatted string, so this compares the number the effect turns the extreme into.
        const auto lo = meta.valueToString(meta.minVal);
        const auto hi = meta.valueToString(meta.maxVal);
        REQUIRE(lo.has_value());
        REQUIRE(hi.has_value());
      }
      REQUIRE(ours == m->desc->numParams);
    }
  }
}

TEST_CASE("fx.reverb keeps ringing after its input stops", "[sst]") {
  Fx fx("fx.reverb", {{"mix", 100.f}, {"decay_time", 8.f}}, /*sine=*/true, 1.f, kSaw);
  fx.run(100);
  const double wet = fx.rms(50);
  REQUIRE(wet > 0.01);

  fx.muteInput();
  fx.run(2);                       // the dry path is gone within a block; only the tail is left
  REQUIRE(fx.rms(50) > wet / 20);  // still ringing

  // The same graph without a reverb goes silent immediately, so the tail is the reverb's doing.
  Fx bypass("fx.eq", {}, /*sine=*/true, 1.f, kSaw);
  bypass.run(100);
  REQUIRE(bypass.rms(50) > 0.05);
  bypass.muteInput();
  bypass.run(2);
  REQUIRE(bypass.rms(50) < 1e-4);
}

TEST_CASE("an sst effect at Mix 0 passes the dry signal through", "[sst]") {
  // Not bit-exact: the effects fade their mix over a block and read it once per sst block, so this
  // is "the dry signal, at its own level", which is what a Mix of nothing has to mean.
  Fx wet("fx.reverb", {{"mix", 100.f}}, /*sine=*/true, 1.f, kSaw);
  Fx dry("fx.reverb", {{"mix", 0.f}}, /*sine=*/true, 1.f, kSaw);
  wet.run(60);
  dry.run(60);
  const double dryRms = dry.rms(60);
  const double wetRms = wet.rms(60);
  REQUIRE(dryRms > 0.1);
  REQUIRE(std::fabs(20.0 * std::log10(wetRms / dryRms)) > 1.0);   // and Mix really does change it
}

/**
 * The block adaptation.
 *
 * An sst effect runs a fixed 32 frames at a time and our block is 64, so the ordinary path just runs
 * it twice. Inside a SAMPLE-accurate feedback cluster the scheduler runs every module a frame at a
 * time, which divides nothing, and `WrappedEffect` buffers for that case. Both have to make sound.
 */
TEST_CASE("an sst effect works a frame at a time, inside a feedback cluster", "[sst]") {
  pg::test::GraphFixture f;
  pg::registerBuiltinModules(f.reg);
  f.node("gate", "test.const", {{"value", 1.f}});
  f.node("src", "osc.wavetable", {{"table", kSaw}, {"level", 1.f}});
  f.edge("g", "gate.out", "src.gate");
  f.node("fx", "fx.reverb", {{"mix", 100.f}});
  f.node("mix", "mix.mixer", {});
  // src -> mixer -> fx -> mixer closes a loop, which is what makes the compiler emit a cluster.
  f.edge("e1", "src.out", "mix.in1");
  f.edge("e2", "mix.out", "fx.in");
  f.edge("e3", "fx.out", "mix.in2");
  auto program = f.compile();
  for (int b = 0; b < 200; ++b) f.run(*program, 64);

  double sum = 0;
  int n = 0;
  for (int b = 0; b < 50; ++b) {
    f.run(*program, 64);
    for (uint32_t i = 0; i < 64; ++i) {
      const double v = f.out(*program, "fx", "out", i);
      sum += v * v;
      ++n;
    }
  }
  const double rms = std::sqrt(sum / n);
  INFO("rms " << rms);
  REQUIRE(rms > 1e-4);           // it made sound
  REQUIRE(std::isfinite(rms));   // and the feedback did not run away
}

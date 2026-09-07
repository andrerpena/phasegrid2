#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <cmath>
#include <map>
#include <memory>
#include <string>
#include "modules/builtin.hpp"
#include "util/GraphFixture.hpp"
#include "util/RtGuard.hpp"

namespace {

const char* kEffects[] = {"fx.reverb",  "fx.delay",      "fx.chorus",     "fx.flanger",
                          "fx.phaser",  "fx.distortion", "fx.compressor", "fx.eq"};

/// A source into one effect. The source is either a gated oscillator (`sine`) or a DC level (`level`);
/// both are steady, which matters because every one of these effects ramps its wet/dry mix and its filter
/// coefficients across the first block it sees. An impulse fired into block 0 is swallowed by that ramp.
struct Fx {
  pg::test::GraphFixture f;
  std::unique_ptr<pg::Program> program;

  Fx(const char* id, std::map<std::string, float> params, bool sine, float level = 1.f) {
    pg::registerBuiltinModules(f.reg);
    f.node("dc", "test.const", {{"value", level}});
    f.node("silence", "test.const", {{"value", 0.f}});
    if (sine) {
      f.node("gate", "test.const", {{"value", 1.f}});
      f.node("src", "osc.wavetable", {{"table", 1.f}, {"level", 1.f}});
      f.edge("g", "gate.out", "src.gate");
    }
    f.node("fx", id, std::move(params));
    f.edge("in", sine ? "src.out" : "dc.out", "fx.in");
    program = f.compile();
  }
  void run(int blocks) { for (int b = 0; b < blocks; ++b) f.run(*program, 64); }
  float at(uint32_t frame, const char* port = "out") { return f.out(*program, "fx", port, frame); }
  double rms(int blocks, const char* node = "fx", const char* port = "out") {
    double sum = 0;
    int n = 0;
    for (int b = 0; b < blocks; ++b) {
      f.run(*program, 64);
      for (uint32_t i = 0; i < 64; ++i) {
        const double v = f.out(*program, node, port, i);
        sum += v * v;
        ++n;
      }
    }
    return std::sqrt(sum / n);
  }
  /// Replaces the source with silence, keeping the same effect instance (nothing structural changed).
  void muteInput() {
    REQUIRE(f.model.removeEdge("in"));
    f.edge("in", "silence.out", "fx.in");
    program = f.compile();
  }
};

}  // namespace

TEST_CASE("every effect has the same audio-in/audio-out shape", "[vital]") {
  pg::Registry reg;
  pg::registerBuiltinModules(reg);
  for (const char* id : kEffects) {
    DYNAMIC_SECTION(id) {
      const pg::RegisteredModule* m = reg.find(id);
      REQUIRE(m != nullptr);
      REQUIRE(m->desc->numInputs == 1);
      REQUIRE(m->findInput("in") == 0);
      REQUIRE(m->findOutput("out") == 0);
      // The vendored effects never create the host's bypass switch, so there is nothing to hide: on the grid
      // an effect is bypassed by unplugging it.
      REQUIRE(m->findParam("on") == -1);
      for (uint32_t i = 0; i < m->desc->numParams; ++i)
        REQUIRE(std::string(m->desc->params[i].id).find(std::string(id).substr(3)) != 0);
    }
  }
}

TEST_CASE("every effect passes audio and is allocation free", "[vital][rt]") {
  for (const char* id : kEffects) {
    DYNAMIC_SECTION(id) {
      Fx fx(id, {}, /*sine=*/true);
      fx.run(50);                                     // let the wet/dry ramps and filter coefficients settle
      REQUIRE(fx.rms(100, "src") > 0.5);              // the source really is producing a signal
      REQUIRE(fx.rms(100) > 0.05);                    // and the effect really is passing one on
      pg::test::resetRtViolations();
      { pg::test::RtScope scope; fx.run(100); }
      REQUIRE(pg::test::rtViolations() == 0);
    }
  }
}

TEST_CASE("fx.delay repeats its input after the time its frequency knob asks for", "[vital]") {
  // Frequency is a power of two in hertz and the delay time is its inverse, so 3 -> 8 Hz -> 6000 samples at
  // 48 kHz. Fully wet with no feedback, the output is silent until that step arrives. The delay line is left
  // to settle on silence first: on its very first block it is still ramping its own wet mix in from zero.
  auto measure = [](float frequency) {
    Fx fx("fx.delay", {{"sync", 0.f}, {"frequency", frequency}, {"feedback", 0.f}, {"dry_wet", 1.f},
                       {"style", 0.f}, {"filter_cutoff", 136.f}, {"filter_spread", 0.f}},
          /*sine=*/false, /*level=*/0.f);
    fx.run(400);
    REQUIRE(fx.at(63) == Catch::Approx(0.f).margin(1e-4));   // silent while the input is silent

    REQUIRE(fx.f.model.removeEdge("in"));
    fx.f.node("hi", "test.const", {{"value", 1.f}});
    fx.f.edge("in", "hi.out", "fx.in");
    fx.program = fx.f.compile();

    for (int b = 0; b < 500; ++b) {
      fx.f.run(*fx.program, 64);
      for (uint32_t i = 0; i < 64; ++i)
        if (fx.at(i) > 0.1f) return b * 64 + static_cast<int>(i);
    }
    return -1;
  };

  REQUIRE(measure(3.f) == Catch::Approx(6000).margin(120));   // 8 Hz
  REQUIRE(measure(4.f) == Catch::Approx(3000).margin(120));   // 16 Hz: half the time, so the knob is live
}

TEST_CASE("fx.distortion clips harder as its drive knob rises", "[vital]") {
  // Hard clip with no filter: a steady 0.5 passes untouched at 0 dB and is driven into the ceiling at 30 dB.
  Fx clean("fx.distortion", {{"type", 1.f}, {"drive", 0.f}, {"mix", 1.f}, {"filter_order", 0.f}},
           /*sine=*/false, 0.5f);
  clean.run(20);
  REQUIRE(clean.at(40) == Catch::Approx(0.5f).margin(0.01f));

  Fx driven("fx.distortion", {{"type", 1.f}, {"drive", 30.f}, {"mix", 1.f}, {"filter_order", 0.f}},
            /*sine=*/false, 0.5f);
  driven.run(20);
  REQUIRE(driven.at(40) == Catch::Approx(1.f).margin(0.01f));
}

TEST_CASE("fx.eq attenuates by the amount its gain knob asks for", "[vital]") {
  // A low shelf whose corner is above DC: at 0 dB the level is untouched, at -15 dB it drops by 15 dB.
  Fx flat("fx.eq", {{"low_mode", 0.f}, {"low_gain", 0.f}, {"low_cutoff", 100.f}}, /*sine=*/false, 0.5f);
  flat.run(200);
  REQUIRE(flat.at(40) == Catch::Approx(0.5f).margin(0.01f));

  Fx cut("fx.eq", {{"low_mode", 0.f}, {"low_gain", -15.f}, {"low_cutoff", 100.f}}, /*sine=*/false, 0.5f);
  cut.run(200);
  REQUIRE(cut.at(40) == Catch::Approx(0.5f * std::pow(10.f, -15.f / 20.f)).margin(0.01f));
}

TEST_CASE("fx.reverb keeps ringing after its input stops", "[vital]") {
  Fx fx("fx.reverb", {{"dry_wet", 1.f}, {"decay_time", 3.f}, {"size", 1.f}}, /*sine=*/true);
  fx.run(100);
  const double wet = fx.rms(50);
  REQUIRE(wet > 0.05);

  fx.muteInput();
  fx.run(2);                       // the dry path is gone within a block; only the tail is left
  REQUIRE(fx.rms(50) > wet / 20);  // still ringing

  // The same graph without a reverb goes silent immediately, so the tail is the reverb's doing.
  Fx bypass("fx.eq", {}, /*sine=*/true);
  bypass.run(100);
  REQUIRE(bypass.rms(50) > 0.05);
  bypass.muteInput();
  bypass.run(2);
  REQUIRE(bypass.rms(50) < 1e-4);
}

TEST_CASE("effect readout outputs carry their value across the whole block", "[vital]") {
  // The compressor's six level meters and the flanger's and phaser's sweep readouts are full-size Outputs the
  // vendored code writes at [0] only, once per block. They have to be broadcast across the block; copying the
  // buffer would leave every frame but the first at zero.
  Fx comp("fx.compressor", {}, /*sine=*/true);
  comp.run(100);
  for (const char* port : {"low_in", "band_in", "high_in", "low_out", "band_out", "high_out"}) {
    INFO(port);
    REQUIRE(comp.at(0, port) > 0.f);
    REQUIRE(comp.at(63, port) == comp.at(0, port));
  }

  Fx flanger("fx.flanger", {{"sync", 0.f}, {"frequency", 0.f}}, /*sine=*/true);
  flanger.run(100);
  REQUIRE(flanger.at(0, "frequency") > 0.f);
  REQUIRE(flanger.at(63, "frequency") == flanger.at(0, "frequency"));

  Fx phaser("fx.phaser", {{"sync", 0.f}, {"frequency", 0.f}}, /*sine=*/true);
  phaser.run(100);
  REQUIRE(phaser.at(0, "cutoff") > 0.f);
  REQUIRE(phaser.at(63, "cutoff") == phaser.at(0, "cutoff"));
}

TEST_CASE("effect params are generated from the vendored parameter table", "[vital]") {
  pg::Registry reg;
  pg::registerBuiltinModules(reg);

  // The tempo divisions the delay offers start at 4/1, because its own `tempo` control runs 4..12 rather than
  // 0..12: the labels have to be read from that offset, not from the start of the vendored name table.
  const pg::RegisteredModule* delay = reg.find("fx.delay");
  const pg::ParamDesc& tempo = delay->desc->params[delay->findParam("tempo")];
  REQUIRE(tempo.min == Catch::Approx(4.f));
  REQUIRE(tempo.enumCount == 9);
  REQUIRE(std::string(tempo.enumLabels[0]) == "4/1");
  REQUIRE(std::string(tempo.enumLabels[8]) == "1/64");

  // A tempo control that does start at zero still reads from the start of the table.
  const pg::RegisteredModule* phaser = reg.find("fx.phaser");
  const pg::ParamDesc& phaserTempo = phaser->desc->params[phaser->findParam("tempo")];
  REQUIRE(phaserTempo.min == Catch::Approx(0.f));
  REQUIRE(std::string(phaserTempo.enumLabels[0]) == "Freeze");

  const pg::RegisteredModule* dist = reg.find("fx.distortion");
  const pg::ParamDesc& type = dist->desc->params[dist->findParam("type")];
  REQUIRE(type.enumCount == 6);
  REQUIRE(std::string(type.enumLabels[4]) == "Bit Crush");
  REQUIRE((dist->desc->params[dist->findParam("drive")].flags & pg::kParamModulatable) != 0);
  REQUIRE(dist->findInput("param:drive") >= 0);

  // The compressor's ratios and thresholds are plain controls with no modulation destination behind them.
  const pg::RegisteredModule* comp = reg.find("fx.compressor");
  REQUIRE(comp->desc->numOutputs == 7);
  REQUIRE((comp->desc->params[comp->findParam("low_upper_ratio")].flags & pg::kParamModulatable) == 0);
  REQUIRE((comp->desc->params[comp->findParam("attack")].flags & pg::kParamModulatable) != 0);
}

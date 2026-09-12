#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <cmath>
#include <map>
#include <memory>
#include <string>
#include "modules/builtin.hpp"
#include "util/Fx.hpp"
#include "util/GraphFixture.hpp"
#include "util/RtGuard.hpp"

namespace {

// The reverb, the delays, the flanger and the phaser left this list when they moved to
// sst-effects; `test_sst_effects.cpp` covers them now. What is here is what is still Vital's.
const char* kEffects[] = {"fx.chorus", "fx.distortion", "fx.compressor", "fx.eq"};

using pg::test::Fx;

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

TEST_CASE("effect readout outputs carry their value across the whole block", "[vital]") {
  // The compressor's six level meters are full-size Outputs the vendored code writes at [0] only, once
  // per block. They have to be broadcast across the block; copying the buffer would leave every frame
  // but the first at zero. (The flanger's and phaser's sweep readouts were the other two cases, and
  // both are sst-backed now.)
  Fx comp("fx.compressor", {}, /*sine=*/true);
  comp.run(100);
  for (const char* port : {"low_in", "band_in", "high_in", "low_out", "band_out", "high_out"}) {
    INFO(port);
    REQUIRE(comp.at(0, port) > 0.f);
    REQUIRE(comp.at(63, port) == comp.at(0, port));
  }

}

TEST_CASE("effect params are generated from the vendored parameter table", "[vital]") {
  pg::Registry reg;
  pg::registerBuiltinModules(reg);

  // A tempo control's labels are read from the vendored name table at the control's OWN offset: the
  // chorus's runs 0..12, so it starts at the first name. (The delay's ran 4..12 and was the sharper
  // case, but the delay is sst-backed now; the rule is the same and this is what still exercises it.)
  const pg::RegisteredModule* chorus = reg.find("fx.chorus");
  const pg::ParamDesc& tempo = chorus->desc->params[chorus->findParam("tempo")];
  REQUIRE(tempo.min == Catch::Approx(0.f));
  REQUIRE(tempo.enumCount == 11);
  REQUIRE(std::string(tempo.enumLabels[0]) == "Freeze");
  REQUIRE(std::string(tempo.enumLabels[10]) == "1/16");

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

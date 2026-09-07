#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <cmath>
#include <nlohmann/json.hpp>
#include <string>
#include "synth_constants.h"
#include "vital/WavetableBank.hpp"
#include "wavetable.h"
#include "wavetable_creator.h"

namespace {

/// Peak absolute sample of one rendered frame. `getAllData()` (not `getAllActiveData()`) is the message-thread
/// view: the "active" pointer is published by the oscillator's own markUsed()/markUnused() handshake and is
/// null until an oscillator has run, so a bank test must read the current data.
float framePeak(vital::Wavetable& table, int frame) {
  const vital::Wavetable::WavetableData* data = table.getAllData();
  float peak = 0.f;
  for (int i = 0; i < vital::Wavetable::kWaveformSize; ++i)
    peak = std::max(peak, std::fabs(data->wave_data[frame][i]));
  return peak;
}

}  // namespace

TEST_CASE("wavetable bank names its built-ins", "[wavetable]") {
  REQUIRE(pg::vendor::WavetableBank::numBuiltins() == 7);
  REQUIRE(std::string(pg::vendor::WavetableBank::builtinName(0)) == "Basic Shapes");
  REQUIRE(std::string(pg::vendor::WavetableBank::builtinName(1)) == "Sine");
  REQUIRE(std::string(pg::vendor::WavetableBank::builtinName(6)) == "Saw");
  REQUIRE(std::string(pg::vendor::WavetableBank::builtinName(99)) == "Basic Shapes");   // clamped, never OOB
}

/**
 * What the bank is responsible for is the SHAPE of the table -- how many frames it holds and that they
 * carry a wave at all. Which waveform each one is belongs to the oscillator that plays it, and is measured
 * against its harmonic series in test_osc_shapes.cpp; a check here could only compare samples against a
 * hand-written curve, which tests the vendored frames rather than our use of them.
 */
TEST_CASE("wavetable bank renders a single frame per shape, and a full table for the morph", "[wavetable]") {
  vital::Wavetable table(vital::kNumOscillatorWaveFrames);

  for (uint32_t shape = 1; shape < pg::vendor::WavetableBank::numBuiltins(); ++shape) {
    INFO("built-in " << shape << ": " << pg::vendor::WavetableBank::builtinName(shape));
    pg::vendor::WavetableBank::renderBuiltin(shape, table);   // same table, re-rendered in place each time
    REQUIRE(table.getAllData()->num_frames == 1);
    REQUIRE(framePeak(table, 0) > 0.5f);
  }

  // Index 0 is the odd one out: it holds the whole morph rather than one shape, so it fills every frame.
  pg::vendor::WavetableBank::renderBuiltin(0, table);
  REQUIRE(table.getAllData()->num_frames == vital::kNumOscillatorWaveFrames);
  REQUIRE(framePeak(table, 0) > 0.5f);
  REQUIRE(framePeak(table, vital::kNumOscillatorWaveFrames - 1) > 0.5f);
}

TEST_CASE("wavetable bank loads the JSON the vendored creator writes", "[wavetable]") {
  vital::Wavetable source(vital::kNumOscillatorWaveFrames);
  WavetableCreator creator(&source);
  creator.initPredefinedWaves();
  const nlohmann::json document = creator.stateToJson();

  vital::Wavetable target(vital::kNumOscillatorWaveFrames);
  REQUIRE(pg::vendor::WavetableBank::loadJson(document, target));
  REQUIRE(target.getAllData()->num_frames == source.getAllData()->num_frames);
  REQUIRE(target.getName() == source.getName());
  for (int i = 0; i < vital::Wavetable::kWaveformSize; ++i)
    REQUIRE(target.getAllData()->wave_data[0][i] == Catch::Approx(source.getAllData()->wave_data[0][i]).margin(1e-4));
}

TEST_CASE("wavetable bank rejects JSON that is not a wavetable", "[wavetable]") {
  vital::Wavetable table(vital::kNumOscillatorWaveFrames);
  const pg::Result r = pg::vendor::WavetableBank::loadJson(nlohmann::json::parse(R"({"nope":1})"), table);
  REQUIRE_FALSE(r);
  REQUIRE(r.code == "E_SCHEMA");
  REQUIRE_FALSE(pg::vendor::WavetableBank::loadFile("/definitely/not/here.json", table));
}

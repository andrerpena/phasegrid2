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

/// Fraction of the frame spent within 10% of its own peak. A square is nearly all extremes (~1), a sine
/// spends most of its time away from them (~0.15). Enough to tell the built-in shapes apart.
float flatness(vital::Wavetable& table, int frame) {
  const vital::Wavetable::WavetableData* data = table.getAllData();
  const float peak = framePeak(table, frame);
  int extreme = 0;
  for (int i = 0; i < vital::Wavetable::kWaveformSize; ++i)
    if (std::fabs(data->wave_data[frame][i]) > 0.9f * peak) ++extreme;
  return static_cast<float>(extreme) / vital::Wavetable::kWaveformSize;
}

}  // namespace

TEST_CASE("wavetable bank names its built-ins", "[wavetable]") {
  REQUIRE(pg::vendor::WavetableBank::numBuiltins() == 7);
  REQUIRE(std::string(pg::vendor::WavetableBank::builtinName(0)) == "Basic Shapes");
  REQUIRE(std::string(pg::vendor::WavetableBank::builtinName(1)) == "Sine");
  REQUIRE(std::string(pg::vendor::WavetableBank::builtinName(6)) == "Saw");
  REQUIRE(std::string(pg::vendor::WavetableBank::builtinName(99)) == "Basic Shapes");   // clamped, never OOB
}

TEST_CASE("wavetable bank renders each built-in as its own shape", "[wavetable]") {
  vital::Wavetable table(vital::kNumOscillatorWaveFrames);

  pg::vendor::WavetableBank::renderBuiltin(1, table);   // Sine
  REQUIRE(table.getAllData()->num_frames == 1);
  REQUIRE(framePeak(table, 0) > 0.5f);
  const float sineFlatness = flatness(table, 0);
  REQUIRE(sineFlatness < 0.3f);

  pg::vendor::WavetableBank::renderBuiltin(4, table);   // Square: same table, re-rendered in place
  REQUIRE(table.getAllData()->num_frames == 1);
  REQUIRE(framePeak(table, 0) > 0.5f);
  REQUIRE(flatness(table, 0) > 0.8f);

  pg::vendor::WavetableBank::renderBuiltin(0, table);   // Basic Shapes: sine .. saw across the whole table
  REQUIRE(table.getAllData()->num_frames == vital::kNumOscillatorWaveFrames);
  REQUIRE(flatness(table, 0) < 0.3f);                                            // first frame is the sine
  REQUIRE(flatness(table, vital::kNumOscillatorWaveFrames * 2 / 3) > 0.6f);       // two thirds in: the square
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

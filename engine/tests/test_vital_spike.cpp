#include <catch2/catch_test_macros.hpp>
#include <cmath>
#include "filter_module.h"
#include "synth_constants.h"
#include "synth_filter.h"
#include "util/RtGuard.hpp"

namespace {
constexpr int kBlock = 64;
constexpr float kRate = 48000.f;

// Runs a standalone FilterModule (digital SVF, 12 dB low-pass near 1 kHz) over a sine of `hz` and returns
// the output RMS over the last second (after settling).
float filteredRms(float hz) {
  vital::FilterModule filter("filter_1");
  filter.init();
  filter.setSampleRate(static_cast<int>(kRate));
  vital::Output audio; vital::cr::Output reset; vital::cr::Output keytrack; vital::Output midi;
  filter.plug(&audio, vital::FilterModule::kAudio);
  filter.plug(&reset, vital::FilterModule::kReset);
  filter.plug(&keytrack, vital::FilterModule::kKeytrack);
  filter.plug(&midi, vital::FilterModule::kMidi);
  vital::control_map controls = filter.getControls();
  controls["filter_1_on"]->set(1.0f);
  controls["filter_1_model"]->set(static_cast<float>(vital::constants::kDigital));
  controls["filter_1_style"]->set(static_cast<float>(vital::SynthFilter::k12Db));
  controls["filter_1_cutoff"]->set(83.0f);     // MIDI note 83 ~ 988 Hz
  controls["filter_1_resonance"]->set(0.3f);
  controls["filter_1_blend"]->set(0.0f);       // low pass
  controls["filter_1_mix"]->set(1.0f);
  controls["filter_1_drive"]->set(0.0f);

  double phase = 0.0; const double inc = hz / kRate;
  double sumSq = 0.0; int counted = 0;
  const int totalBlocks = 2 * 48000 / kBlock;
  for (int b = 0; b < totalBlocks; ++b) {
    for (int i = 0; i < kBlock; ++i) { audio.buffer[i] = vital::poly_float(static_cast<float>(std::sin(2.0 * M_PI * phase))); phase += inc; if (phase >= 1.0) phase -= 1.0; }
    filter.process(kBlock);
    if (b >= totalBlocks / 2) for (int i = 0; i < kBlock; ++i) { const float v = filter.output()->buffer[i][0]; sumSq += v * v; ++counted; }
  }
  return static_cast<float>(std::sqrt(sumSq / counted));
}
}  // namespace

TEST_CASE("vendored FilterModule runs standalone and low-passes", "[vital]") {
  const float low = filteredRms(200.f);
  const float high = filteredRms(8000.f);
  REQUIRE(low > 0.5f);                 // passband: ~ -3 dB or better relative to 0.707 input RMS
  REQUIRE(high < low * 0.1f);          // > 20 dB down three octaves above cutoff
}

TEST_CASE("vendored FilterModule steady state is allocation free", "[vital][rt]") {
  vital::FilterModule filter("filter_1");
  filter.init();
  filter.setSampleRate(48000);
  vital::Output audio; vital::cr::Output reset; vital::cr::Output keytrack; vital::Output midi;
  filter.plug(&audio, vital::FilterModule::kAudio); filter.plug(&reset, vital::FilterModule::kReset);
  filter.plug(&keytrack, vital::FilterModule::kKeytrack); filter.plug(&midi, vital::FilterModule::kMidi);
  filter.getControls()["filter_1_on"]->set(1.0f);
  for (int i = 0; i < 4; ++i) filter.process(kBlock);   // warm up: first process may lazily sort
  pg::test::resetRtViolations();
  { pg::test::RtScope scope; for (int i = 0; i < 1000; ++i) filter.process(kBlock); }
  REQUIRE(pg::test::rtViolations() == 0);
}

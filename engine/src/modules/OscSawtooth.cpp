#include "modules/osc/Oscillator.hpp"

namespace pg::modules {
namespace {

/**
 * `osc.sawtooth`: the basic sawtooth, with hard sync.
 *
 * Everything an oscillator does -- pitch, phase, reset, sync, band-limiting, the picture on its face --
 * is in `osc/Oscillator.hpp`. What is a sawtooth rather than some other wave is only this: a ramp from
 * -1 to 1, and the fact that it drops by 2 when it wraps.
 */
struct SawShape {
  float at(double phase) const { return static_cast<float>(2.0 * phase - 1.0); }
  uint32_t jumpCount() const { return 1; }
  osc::ShapeJump jump(uint32_t) const { return {0.0, -2.0}; }
};

const ParamDesc kParams[] = {osc::kSyncParam};

/// The face: the three inputs down the left, the wave beside them, sync on its right, the output last.
const char* const kFace[] = {
  "reset wave wave wave sync sync out",
  "phase wave wave wave sync sync .  ",
  "pitch .    .    .    .    .    .  ",
};

class OscSawtooth final : public VoicedModule<osc::OscillatorState> {
  void process(ProcessContext& c) override {
    const ParamView sync = c.param(0);
    osc::render(
      c, st(c), [](uint32_t, uint32_t) { return SawShape{}; },
      [&sync](uint32_t i, uint32_t lane) { return static_cast<double>(lanes::lane(sync.at(i), lane)); });
  }

  bool preview(const ParamValues& values, float* out, uint32_t count) override {
    const auto it = values.find("sync");
    const double semitones = it == values.end() ? 0.0 : static_cast<double>(it->second);
    osc::preview(SawShape{}, std::exp2(semitones / 12.0), out, count);
    return true;
  }
};

}  // namespace

// Explicit `extern` (see AudioOut.cpp): a namespace-scope `const` is internal linkage by default.
extern const ModuleDescriptor kOscSawtooth{kModuleAbiVersion, "osc.sawtooth", "Sawtooth", "osc",
  "A band-limited sawtooth with hard sync. Sync, in semitones, runs a second ramp faster than the pitch and "
  "restarts it every cycle, which keeps the pitch and adds the classic sync harmonics. The face shows the "
  "resulting shape.",
  osc::kOscInputs, countOf(osc::kOscInputs), osc::kOscOutputs, countOf(osc::kOscOutputs),
  kParams, countOf(kParams), kModulePreviewsWave, 0,
  [] () -> Module* { return new OscSawtooth(); }, kFace, countOf(kFace)};

}  // namespace pg::modules

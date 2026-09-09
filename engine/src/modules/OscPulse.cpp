#include "modules/osc/Oscillator.hpp"

namespace pg::modules {
namespace {

/**
 * `osc.pulse`: the basic pulse, with hard sync.
 *
 * The whole module, next to the sawtooth, is the argument for `osc/Oscillator.hpp`: two waves that
 * sound nothing alike differ by four numbers. High for the first part of the cycle and low for the
 * rest, stepping up by 2 where it starts and down by 2 where it ends.
 *
 * `width` is fixed at a half, which makes it a square. It is a member rather than a constant because
 * Pulse Width is a knob this will grow: the shape is built afresh for every sample, so a width that
 * came from a modulated parameter would need nothing here to change but where the number comes from.
 */
struct PulseShape {
  double width = 0.5;
  float at(double phase) const { return phase < width ? 1.f : -1.f; }
  uint32_t jumpCount() const { return 2; }
  osc::ShapeJump jump(uint32_t index) const {
    return index == 0 ? osc::ShapeJump{0.0, 2.0} : osc::ShapeJump{width, -2.0};
  }
};

const ParamDesc kParams[] = {osc::kSyncParam};

/// The face: the three inputs down the left, the wave beside them, sync on its right, the output last.
const char* const kFace[] = {
  "reset wave wave wave sync sync out",
  "phase wave wave wave sync sync .  ",
  "pitch .    .    .    .    .    .  ",
};

class OscPulse final : public VoicedModule<osc::OscillatorState> {
  void process(ProcessContext& c) override {
    const ParamView sync = c.param(0);
    osc::render(
      c, st(c), [](uint32_t, uint32_t) { return PulseShape{}; },
      [&sync](uint32_t i, uint32_t lane) { return static_cast<double>(lanes::lane(sync.at(i), lane)); });
  }

  bool preview(const ParamValues& values, float* out, uint32_t count) override {
    const auto it = values.find("sync");
    const double semitones = it == values.end() ? 0.0 : static_cast<double>(it->second);
    osc::preview(PulseShape{}, std::exp2(semitones / 12.0), out, count);
    return true;
  }
};

}  // namespace

// Explicit `extern` (see AudioOut.cpp): a namespace-scope `const` is internal linkage by default.
extern const ModuleDescriptor kOscPulse{kModuleAbiVersion, "osc.pulse", "Pulse", "osc",
  "A band-limited pulse with hard sync. Sync, in semitones, runs the wave faster than the pitch and restarts "
  "it every cycle, which keeps the pitch and packs more pulses into it. The face shows the resulting shape.",
  osc::kOscInputs, countOf(osc::kOscInputs), osc::kOscOutputs, countOf(osc::kOscOutputs),
  kParams, countOf(kParams), kModulePreviewsWave, 0,
  [] () -> Module* { return new OscPulse(); }, kFace, countOf(kFace)};

}  // namespace pg::modules

#include "sst/Descriptors.hpp"
#include "sst/effects/Reverb2.h"

namespace pg::modules {

/**
 * `fx.reverb` -- the Surge Synth Team's Reverb 2, hosted through `engine/src/sst`.
 *
 * This replaced a reverb written here by hand (docs/adrs/0009, now superseded). The lesson that led
 * to the change is worth keeping next to the module: writing a plate from scratch is a poor use of
 * the effort, and every primitive that reverb needed -- allpass, interpolating delay line, one-pole
 * damper, quadrature modulator -- already exists in a library that is tested and maintained.
 *
 * Ten controls, and each is the effect's own: the descriptor's ranges, units and tapers are
 * generated from `Reverb2::paramAt`, not written out here, so a knob that says seconds carries
 * seconds. Decay Time runs 62 ms to 64 s on a logarithmic taper, which is the effect's native
 * -4..6 read through its own display scaling.
 *
 * It is a global effect: put it after `voices.sum` so it runs once on the whole chord rather than
 * once per voice.
 */
const ModuleDescriptor& fxReverb() {
  static const ModuleDescriptor& desc = []() -> const ModuleDescriptor& {
    using Reverb2 = sst::effects::reverb2::Reverb2<sstfx::Config>;
    sstfx::EffectSpec spec = sstfx::effectSpec<Reverb2>(
      "fx.reverb", "Reverb",
      "An algorithmic reverb. Room Size and Decay Time set the space and how long it rings; "
      "Diffusion and Buildup how smoothly the early and late reflections spread; LF and HF Damping "
      "which end of the spectrum dies away first; Pre-Delay the gap before it starts, Modulation "
      "how much the tail drifts, Width its stereo spread and Mix how much of it you hear.");
    /*
     * Our defaults, not the effect's, and each one measured.
     *
     * Reverb 2 ships the settings its author chose inside Surge, where you dial it before you judge
     * it. Dropped on a canvas as-is over a plucked C3 sine it is a quiet, indistinct wash: LF
     * Damping at 20 % takes 7.7 dB and half the tail off anything with low end in it, and the
     * shipped Decay Time leaves a T60 of about 1.5 s. Together these give a T60 of 5 s at 11 dB
     * more level -- a reverb that sounds like one before you touch it. See docs/adrs/0010.
     */
    spec.overrides = {
      {.param = "lf_damping", .hasDefault = true, .def = 0.f},
      {.param = "decay_time", .hasDefault = true, .def = 8.f},
      {.param = "room_size", .hasDefault = true, .def = 50.f},
      {.param = "mix", .hasDefault = true, .def = 50.f},
    };
    spec.face = {"room_size", "decay_time", "diffusion", "mix"};
    spec.faceRows = {
      "in pre_delay pre_delay room_size room_size decay_time decay_time decay_time decay_time diffusion diffusion buildup buildup out",
      ".  pre_delay pre_delay room_size room_size decay_time decay_time decay_time decay_time diffusion diffusion buildup buildup .",
      ".  modulation modulation lf_damping lf_damping hf_damping hf_damping width width mix mix . . .",
      ".  modulation modulation lf_damping lf_damping hf_damping hf_damping width width mix mix . . .",
    };
    return sstfx::buildDescriptor(spec);
  }();
  return desc;
}

}  // namespace pg::modules

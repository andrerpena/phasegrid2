#include <string>
#include "lfo_module.h"
#include "vital/Descriptors.hpp"

namespace pg::modules {
namespace {

/// The wave the LFO's line source is initialised to. These are the vendored `LineGenerator`'s own built-in
/// shapes; the line itself is read by the audio thread every block, so re-rendering it in place would race
/// with `process()`. The param is structural instead: changing it builds a new instance with a new line.
const char* const kShapeNames[] = {"Sine", "Triangle", "Square", "Saw Up", "Saw Down"};

void initShape(LineGenerator& line, uint32_t shape) {
  switch (shape) {
    case 1: line.initTriangle(); break;
    case 2: line.initSquare(); break;
    case 3: line.initSawUp(); break;
    case 4: line.initSawDown(); break;
    default: line.initSin(); break;
  }
}

}  // namespace

/// mod.lfo -- the vendored low-frequency oscillator, running at audio rate so it can drive an audio-rate
/// destination without stepping once per block. Its output is UNIPOLAR (0..1): the line source runs from the
/// bottom of the shape to the top and back, and the vendored code never re-centres it.
const ModuleDescriptor& modLfo() {
  static const ModuleDescriptor& desc = [] () -> const ModuleDescriptor& {
    vendor::ModuleSpec spec;
    spec.id = "mod.lfo";
    spec.name = "LFO";
    spec.category = "mod";
    spec.doc = "Low-frequency oscillator over one of five built-in shapes. Output is 0..1. Frequency is a "
               "power of two in hertz (2 = 4 Hz) while Sync is Seconds; the other Sync modes divide the "
               "transport tempo or track the pitch input.";
    spec.prefix = "lfo_1";
    spec.create = [](vendor::ModuleContext& ctx) {
      return vendor::makeModule<vital::LfoModule>(std::string("lfo_1"), &ctx.lineGenerator(), ctx.beatsPerSecond());
    };
    // The vendored module puts itself at control rate in its constructor, which makes it write one value per
    // block. We want a signal, so switch it (and the oscillator inside it) to audio rate before init().
    spec.configure = [](vital::SynthModule& m) { m.setControlRate(false); };
    spec.inputs = {
      {"gate", "Gate", vital::LfoModule::kNoteTrigger, vendor::BindKind::Gate, SignalRole::Gate,
       "Gate: a rising edge restarts the shape, a falling edge ends the sustain sync modes"},
      {"count", "Note Count", vital::LfoModule::kNoteCount, vendor::BindKind::NoteCount, SignalRole::Cv,
       "How many notes are held; the phase output encodes it"},
      {"pitch", "Pitch", vital::LfoModule::kMidi, vendor::BindKind::PitchAsMidi, SignalRole::Pitch,
       "Pitch the Keytrack sync mode tunes the rate to"},
    };
    spec.outputs = {
      {"out", "Out", vital::LfoModule::kValue, SignalRole::Cv, "The shape, 0..1"},
      // Both of these are full-size Outputs that the vendored oscillator only ever writes at [0]: one value
      // per block, not one per sample. Copying the whole buffer would hand on 127 frames of stale data.
      {"phase", "Phase", vital::LfoModule::kOscPhase, SignalRole::Phase,
       "Position in the shape plus the note count, encoded the same way as the envelope's phase: 2.0 is the "
       "start of the cycle, 2.5 halfway",
       /*firstFrameOnly=*/true},
      {"frequency", "Frequency", vital::LfoModule::kOscFrequency, SignalRole::Cv,
       "The rate the oscillator settled on this block, in hertz", /*firstFrameOnly=*/true},
    };
    spec.extraParams = {
      ParamDesc{"shape", "Shape", 0.f, static_cast<float>(countOf(kShapeNames) - 1), 0.f, ParamUnit::None,
                ParamCurve::Linear, kParamEnum | kParamInteger | kParamNoSmooth | kParamStructural,
                kShapeNames, countOf(kShapeNames), "select", nullptr, "Wave the oscillator runs over"},
    };
    spec.onConfigure = [](vital::SynthModule&, vendor::ModuleContext& ctx, const ParamValues& values) {
      auto it = values.find("shape");
      initShape(ctx.lineGenerator(), it == values.end() ? 0u : static_cast<uint32_t>(it->second));
    };
    spec.needsBeatsPerSecond = true;
    return vendor::buildDescriptor(spec);
  }();
  return desc;
}

}  // namespace pg::modules

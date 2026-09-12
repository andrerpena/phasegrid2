#include <algorithm>
#include <cmath>
#include <cstdint>

#include "core/Module.hpp"
#include "core/Voices.hpp"
#include "services/Telemetry.hpp"

namespace pg::modules {
namespace {

/**
 * `display.piano`: a keyboard on the face that lights the keys being played.
 *
 * It takes the pitch and gate a note converter produces, one pair of values per voice, and publishes
 * which MIDI notes are down (`TelemetryKind::Keys`). Not a `Display` subclass: those fold every voice
 * into one stereo picture, and the whole point here is to keep the voices apart -- each one lights
 * its own key. Like the readout it reads the block's LAST frame: what is held now is the question,
 * and a block is a millisecond.
 *
 * The keyboard's range is the module's parameters and the interface reads them from the document;
 * nothing about the range crosses telemetry, so a knob turn reshapes the keyboard at once.
 */
const PortDesc kIn[] = {
  {"pitch", "Pitch", PortKind::Continuous, 1, SignalRole::Pitch,
   "The pitch each voice is playing, 0.1 per octave from middle C, as a note converter puts out"},
  {"gate", "Gate", PortKind::Continuous, 1, SignalRole::Gate,
   "High while the voice's key is down. Inside an instrument the voices know this themselves, so it can stay unconnected; "
   "outside one, an unconnected gate means held, so a bare pitch lights one key"},
};

const ParamDesc kParams[] = {
  {"octaves", "Octaves", 1.f, 6.f, 2.f, ParamUnit::None, ParamCurve::Linear,
   kParamPrimary | kParamInteger | kParamNoSmooth, nullptr, 0, "knob", nullptr,
   "How many octaves the keyboard shows. It fills its block whatever the number, so more octaves means narrower keys"},
  {"low", "Low", -1.f, 8.f, 3.f, ParamUnit::None, ParamCurve::Linear,
   kParamInteger | kParamNoSmooth, nullptr, 0, "slider", nullptr,
   "The octave the keyboard starts on: 3 is C3, one octave below middle C (C4)"},
};

/// The keyboard seven cells wide with the two inputs at its left and the octave knob at its right.
const char* const kFace[] = {
  "pitch piano piano piano piano piano piano piano octaves octaves",
  "gate  piano piano piano piano piano piano piano octaves octaves",
};

class Piano final : public Module {
public:
  void prepare(const PrepareInfo&) override {
    std::fill_n(keys_, kTelemetryMaxKeys, 0.f);
    block_ = 0;
  }

  void process(ProcessContext& c) override {
    // Nobody watching: the fast path every display module has. The writer would refuse an
    // out-of-range slot anyway; this only saves the work.
    if (c.telemetry == nullptr || c.displaySlot == kNoTelemetrySlotCtx || c.numFrames == 0) return;
    if (c.firstPass) std::fill_n(keys_, kTelemetryMaxKeys, 0.f);
    // Nothing cabled into Pitch is nothing to show. An unconnected input reads as zero, and zero is
    // middle C: without this an idle keyboard would light C4 for ever.
    if (c.in(0).empty()) {
      if (c.lastPass) c.telemetry->writeKeys(c.displaySlot, keys_, kTelemetryMaxKeys, ++block_);
      return;
    }

    const uint32_t last = c.numFrames - 1;
    const Sample pitch = c.in(0).readOr()[last];
    const bool gateUnconnected = c.in(1).empty();
    const Sample gate = c.in(1).readOr()[last];
    // Lane 0 is this pair's first voice, lane 2 its second; the mask says whether each exists.
    for (uint32_t lane = 0; lane < 4; lane += 2) {
      if (c.voiceMask[static_cast<int>(lane)] == 0) continue;
      // Inside an instrument the pool knows which voices are down, so a key is lit only while its
      // voice holds a note: a released voice ringing out, or an idle one still carrying its last
      // pitch, is not a pressed key. Outside one, a bare pitch lights a key unless a gate says otherwise.
      const bool down = c.activity != nullptr
        ? c.activity->state(2 * c.voice + lane / 2) == VoiceState::Held && (gateUnconnected || gateHigh(lanes::lane(gate, lane)))
        : gateUnconnected || gateHigh(lanes::lane(gate, lane));
      if (!down) continue;
      const long note = std::lround(pitchToMidiNote(lanes::lane(pitch, lane)));
      if (note < 0 || note >= static_cast<long>(kTelemetryMaxKeys)) continue;
      keys_[note] = 1.f;
    }

    if (!c.lastPass) return;   // more pairs still to add their voices
    c.telemetry->writeKeys(c.displaySlot, keys_, kTelemetryMaxKeys, ++block_);
  }

private:
  float keys_[kTelemetryMaxKeys] = {};
  uint64_t block_ = 0;
};

}  // namespace

extern const ModuleDescriptor kPiano{kModuleAbiVersion, "display.piano", "Piano", "Display",
  "A keyboard that lights the keys being played. Feed it the pitch and gate a note converter puts out "
  "and each voice lights its own key; leave the gate unconnected and a pitch alone lights one. Octaves "
  "sets how much of the keyboard is shown and Low which octave it starts on. Produces no audio and "
  "changes nothing.",
  kIn, countOf(kIn), nullptr, 0, kParams, countOf(kParams), kModuleWritesTelemetry | kModulePublishesKeys, 1,
  [] () -> Module* { return new Piano(); }, kFace, countOf(kFace)};

}  // namespace pg::modules

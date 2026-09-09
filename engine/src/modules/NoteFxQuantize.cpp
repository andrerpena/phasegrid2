#include <algorithm>
#include <cmath>
#include <cstdint>
#include "core/Module.hpp"
#include "modules/NoteFx.hpp"

namespace pg::modules {
namespace {

using notefx::HeldNote;

const PortDesc kIn[] = {
  {"notes", "Notes", PortKind::Event, 0, SignalRole::Note, "The notes to snap to the project's scale"},
};
const PortDesc kOut[] = {
  {"notes", "Notes", PortKind::Event, 0, SignalRole::Note, "The same notes, each moved to a pitch in the scale"},
};

const char* kModeLabels[] = {"Nearest", "Down", "Up"};
const ParamDesc kParams[] = {
  {"mode", "Mode", 0.f, 2.f, 0.f, ParamUnit::None, ParamCurve::Linear,
   kParamEnum | kParamInteger | kParamNoSmooth, kModeLabels, countOf(kModeLabels), "select", nullptr,
   "Where a note outside the scale goes: to the nearest scale tone (downward on a tie), or always down, or always up"},
};

constexpr uint32_t kMaxHeld = 64;

/// The scale tone `midi` becomes under `mode`, or `midi` itself if nothing in range is in the scale,
/// which cannot happen with a non-empty mask except at the very ends of the range.
float snap(float midi, int mode, const TransportSnapshot& t) {
  const int note = static_cast<int>(std::lround(midi));
  for (int distance = 0; distance <= 11; ++distance) {
    // Nearest tries below before above at each distance, which is how a tie resolves downward.
    const int candidates[2] = {note - distance, note + distance};
    for (const int candidate : candidates) {
      if (mode == 1 && candidate > note) continue;   // Down never goes up
      if (mode == 2 && candidate < note) continue;   // Up never goes down
      if (candidate < 0 || candidate > 127) continue;
      if (t.inScale(candidate)) return static_cast<float>(candidate);
    }
  }
  return midi;
}

/// A pitch quantiser fed by the project's key and scale, which reach it on the transport.
///
/// The snapped pitch is fixed at the note ON and remembered against the incoming one, so a change of
/// key under a held note releases the pitch that is actually sounding. With the default chromatic
/// scale every note is already in it and the module is a wire.
class NoteFxQuantize final : public notefx::NoteFxModule {
  void advance(const ProcessContext& c) override {
    const int mode = std::clamp(static_cast<int>(lanes::lane(c.param(0).at(0), 0)), 0, 2);
    for (const Event& e : c.eventIn(0)) {
      if (e.frame >= c.numFrames) continue;
      if (e.type == EventType::NoteOn) {
        const float pitch = snap(e.a, mode, *c.transport);
        const Event on = noteOn(e.frame, pitch, e.b);
        if (!record(on)) continue;
        HeldNote h;
        h.in = e.a;
        h.id = e.noteId;
        h.out[0] = pitch;
        h.outId[0] = on.noteId;
        h.count = 1;
        if (!held_.add(h)) record(noteOff(e.frame, pitch, on.noteId));
      } else if (e.type == EventType::NoteOff) {
        HeldNote h;
        if (!held_.take(e.a, h)) continue;
        record(noteOff(e.frame, h.out[0], h.outId[0]));
      } else {
        record(e);
      }
    }
  }

  notefx::HeldTable<kMaxHeld> held_;
};

}  // namespace

const ModuleDescriptor& noteFxQuantize() {
  static const ModuleDescriptor d{kModuleAbiVersion, "notefx.quantize", "Quantize", "Note FX",
    "Moves every note onto the project's scale, set in the strip above the grid: a C# played in C major "
    "comes out as C. Nearest goes to the closest scale tone, Down and Up always go one way. In a "
    "chromatic project nothing moves. The snapped pitch is fixed when the note starts, so changing the "
    "key under a held note still releases the right one.",
    kIn, countOf(kIn), kOut, countOf(kOut), kParams, countOf(kParams), kModuleNeedsTransport, 0,
    [] () -> Module* { return new NoteFxQuantize(); }, nullptr, 0};
  return d;
}

}  // namespace pg::modules

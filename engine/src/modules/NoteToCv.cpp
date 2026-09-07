#include <algorithm>
#include <array>
#include <cmath>
#include "core/Module.hpp"

namespace pg::modules {
namespace {

/// How many notes can be held at once. Anything beyond this drops the oldest, so "last note wins" keeps
/// working under a stuck pedal instead of ignoring everything the player does next.
constexpr uint32_t kMaxHeld = 16;

const PortDesc kIn[] = {
  {"notes", "Notes", PortKind::Event, 0, SignalRole::Any, "Note events to play, monophonically"},
};
const PortDesc kOut[] = {
  {"pitch", "Pitch", PortKind::Continuous, 1, SignalRole::Pitch, "Pitch of the sounding note, 0.1 per octave from middle C"},
  {"gate", "Gate", PortKind::Continuous, 1, SignalRole::Gate, "1 while a note is held; drops for one frame when a new note arrives"},
  {"velocity", "Velocity", PortKind::Continuous, 1, SignalRole::Cv, "Velocity of the note that last started, 0..1"},
};
const char* kModeLabels[] = {"Last", "Low", "High"};
const ParamDesc kParams[] = {
  {"mode", "Priority", 0.f, 2.f, 0.f, ParamUnit::None, ParamCurve::Linear,
   kParamEnum | kParamInteger | kParamNoSmooth, kModeLabels, countOf(kModeLabels), "select", nullptr,
   "Which of the held notes sounds: the newest, the lowest or the highest"},
  {"glide", "Glide", 0.f, 1.f, 0.f, ParamUnit::Seconds, ParamCurve::Linear, kParamModulatable, nullptr, 0,
   "slider", nullptr, "Time constant of the slide from one note to the next; 0 jumps"},
};

struct State {
  std::array<float, kMaxHeld> held{};   // MIDI note numbers, oldest first
  uint32_t heldCount = 0;
  float current = kMiddleCMidi;         // the glided note actually sounding
  float target = kMiddleCMidi;
  float velocity = 0.f;
  bool gate = false;
};

void pushHeld(State& s, float note) {
  if (s.heldCount == kMaxHeld) {
    for (uint32_t i = 1; i < kMaxHeld; ++i) s.held[i - 1] = s.held[i];
    --s.heldCount;
  }
  s.held[s.heldCount++] = note;
}

void removeHeld(State& s, float note) {
  for (uint32_t i = s.heldCount; i > 0; --i) {   // newest first: a repeated note releases its latest press
    if (s.held[i - 1] != note) continue;
    for (uint32_t k = i; k < s.heldCount; ++k) s.held[k - 1] = s.held[k];
    --s.heldCount;
    return;
  }
}

/// The note that should sound given the held stack and the priority mode. With nothing held the last target
/// stays, so releasing the final note does not make the pitch jump while the envelope is still releasing.
float notePriority(const State& s, int mode) {
  if (s.heldCount == 0) return s.target;
  const float* first = s.held.data();
  const float* last = first + s.heldCount;
  if (mode == 1) return *std::min_element(first, last);
  if (mode == 2) return *std::max_element(first, last);
  return s.held[s.heldCount - 1];
}

class NoteToCv final : public VoicedModule<State> {
  void process(ProcessContext& c) override {
    State& s = st(c);
    const EventBuffer& events = c.eventIn(0);
    const int mode = static_cast<int>(lanes::lane(c.param(0).at(0), 0));
    const float glide = std::max(0.f, lanes::lane(c.param(1).at(0), 0));
    // One-pole coefficient for this block. 0 means "jump", which is what a glide time of 0 must do.
    const float coeff = glide > 0.f ? std::exp(static_cast<float>(-1.0 / (glide * info().sampleRate))) : 0.f;

    const Mask voice0 = lanes::voice(0);
    Sample* pitchOut = c.out(0).data;
    Sample* gateOut = c.out(1).data;
    Sample* velocityOut = c.out(2).data;

    uint32_t next = 0;
    for (uint32_t i = 0; i < c.numFrames; ++i) {
      // A new note while one is already held drops the gate for exactly this frame, so a downstream envelope
      // sees an edge and retriggers instead of sliding to the new pitch at its sustain level.
      bool retrigger = false;
      for (; next < events.size() && events[next].frame <= i; ++next) {
        const Event& e = events[next];
        if (e.type == EventType::NoteOn) {
          retrigger = retrigger || s.gate;
          pushHeld(s, e.a);
          s.velocity = e.b;
          s.gate = true;
          s.target = notePriority(s, mode);
        } else if (e.type == EventType::NoteOff) {
          removeHeld(s, e.a);
          if (s.heldCount == 0) s.gate = false;
          else s.target = notePriority(s, mode);
        }
      }
      s.current = s.target + coeff * (s.current - s.target);
      pitchOut[i] = Sample(midiNoteToPitch(s.current)) & voice0;
      gateOut[i] = Sample(s.gate && !retrigger ? 1.f : 0.f) & voice0;
      velocityOut[i] = Sample(s.velocity) & voice0;
    }
  }
};

}  // namespace

// Explicit `extern` (see AudioOut.cpp): a namespace-scope `const` is internal linkage by default.
extern const ModuleDescriptor kNoteToCv{kModuleAbiVersion, "note.toCv", "Note to CV", "note",
  "Turns note events into pitch, gate and velocity signals. Monophonic: one note sounds at a time, chosen by "
  "the priority mode, and the gate stays high while any note is held.",
  kIn, countOf(kIn), kOut, countOf(kOut), kParams, countOf(kParams), 0, 0,
  [] () -> Module* { return new NoteToCv(); }};

}  // namespace pg::modules

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <iterator>
#include "core/Module.hpp"
#include "modules/Division.hpp"
#include "modules/NoteFx.hpp"

namespace pg::modules {
namespace {

const PortDesc kIn[] = {
  {"notes", "Notes", PortKind::Event, 0, SignalRole::Note, "The notes to arpeggiate: whatever is held is played one at a time"},
};
const PortDesc kOut[] = {
  {"notes", "Notes", PortKind::Event, 0, SignalRole::Note, "One note per step, chosen from the held ones by the mode"},
};

const char* kModeLabels[] = {"Up", "Down", "Up-Down", "As played", "Random"};
enum Mode : int { Up = 0, Down, UpDown, AsPlayed, Random };

const ParamDesc kParams[] = {
  {"rate", "Rate", 0.f, static_cast<float>(kDivisionCount - 1), 0.f, ParamUnit::None,
   ParamCurve::Linear, kParamEnum | kParamInteger | kParamNoSmooth, kDivisionLabels, kDivisionCount,
   "select", nullptr, "How long each step lasts, in musical time"},
  {"mode", "Mode", 0.f, static_cast<float>(std::size(kModeLabels) - 1), 0.f, ParamUnit::None,
   ParamCurve::Linear, kParamEnum | kParamInteger | kParamNoSmooth, kModeLabels, countOf(kModeLabels),
   "select", nullptr, "The order the held notes are played in"},
  {"octaves", "Octaves", 1.f, 4.f, 1.f, ParamUnit::None, ParamCurve::Linear,
   kParamPrimary | kParamInteger | kParamNoSmooth, nullptr, 0, "slider", nullptr,
   "How many octaves the pattern climbs through before it repeats"},
  {"gate", "Gate", 0.05f, 1.f, 0.5f, ParamUnit::Ratio, ParamCurve::Linear,
   kParamPrimary | kParamModulatable, nullptr, 0, "knob", nullptr,
   "How much of its step each note holds. At 1 a note ends exactly where the next begins"},
};

const char* const kFace[] = {
  "in:notes octaves octaves gate gate out:notes",
  ".        octaves octaves gate gate .        ",
};

/// Input notes held at once. A hand has ten fingers and a clip may hold a few more.
constexpr uint32_t kMaxHeld = 32;

struct Held {
  float pitch = 0.f;
  float velocity = 0.f;
};

/// An arpeggiator: plays the held notes one at a time, on a grid derived from the transport.
///
/// The step clock is DERIVED from the transport rather than counted (the rule `notes.pattern` and
/// `phase.clock` follow), so the arpeggio lines up with everything else on the grid, follows a seek,
/// and free-runs at the project tempo while the transport is stopped. A note that arrives mid-step
/// waits for the next boundary; a chord that starts on one is heard on that step.
///
/// One note sounds at a time. It is released at `gate` of its step, at the next step boundary, when
/// the last held note is let go, or when the transport jumps backwards -- whichever comes first --
/// and it is released at the pitch it was played at, octave and all.
class NoteFxArp final : public notefx::NoteFxModule {
  void onPrepare(const PrepareInfo&) override {
    heldCount_ = 0;
    sounding_ = false;
    sequenceIndex_ = 0;
    haveLast_ = false;
    lastStep_ = 0;
    lastPos_ = 0.0;
  }

  void advance(const ProcessContext& c) override {
    const TransportSnapshot& t = *c.transport;
    const double quarters = quartersPerCycle(static_cast<uint32_t>(lanes::lane(c.param(0).at(0), 0)), t);
    const double quartersPerSample = (t.tempo > 0.0 ? t.tempo : 120.0) / (60.0 * c.sampleRate);
    const double startQuarters = t.playing ? t.ppq : static_cast<double>(t.samplePos) * quartersPerSample;
    const double stepsPerSample = quarters > 0.0 ? quartersPerSample / quarters : 0.0;
    const double blockStart = quarters > 0.0 ? startQuarters / quarters : 0.0;
    const int mode = std::clamp(static_cast<int>(lanes::lane(c.param(1).at(0), 0)), 0, static_cast<int>(Random));
    const int octaves = std::clamp(static_cast<int>(lanes::lane(c.param(2).at(0), 0)), 1, 4);

    const EventBuffer& in = c.eventIn(0);
    uint32_t next = 0;
    for (uint32_t i = 0; i < c.numFrames; ++i) {
      // Presses and releases at this frame first, so a chord that lands on a step is heard on it.
      for (; next < in.size() && in[next].frame <= i; ++next) {
        const Event& e = in[next];
        if (e.type == EventType::NoteOn) press(e.a, e.b);
        else if (e.type == EventType::NoteOff) release(e.a);
      }

      const double position = blockStart + static_cast<double>(i) * stepsPerSample;
      const int64_t step = static_cast<int64_t>(std::floor(position));
      // A jump backwards is a restart: whatever was sounding stops, and the step fires again.
      if (haveLast_ && position < lastPos_) {
        stopSounding(i);
        haveLast_ = false;
      }
      lastPos_ = position;

      if (heldCount_ == 0) {
        stopSounding(i);
        sequenceIndex_ = 0;   // the next chord starts from its first note
      } else if (sounding_ && position >= gateEnd_) {
        stopSounding(i);
      }

      const bool boundary = !haveLast_ || step != lastStep_;
      if (boundary && heldCount_ > 0) {
        stopSounding(i);
        const float gate = std::clamp(lanes::lane(c.param(3).at(i), 0), 0.05f, 1.f);
        const Held h = pick(mode, octaves);
        const Event on = noteOn(i, h.pitch, h.velocity);
        if (record(on)) {
          sounding_ = true;
          soundingPitch_ = h.pitch;
          soundingId_ = on.noteId;
          gateEnd_ = static_cast<double>(step) + static_cast<double>(gate);
        }
      }
      lastStep_ = step;
      haveLast_ = true;
    }
  }

  /// The next note of the pattern, across the held notes and `octaves`. Advances the sequence.
  Held pick(int mode, int octaves) {
    const uint32_t length = heldCount_ * static_cast<uint32_t>(octaves);
    uint32_t k;
    if (mode == Random) {
      k = rng_.next() % length;
    } else if (mode == UpDown && length > 1) {
      // Bounce without repeating the ends: up the whole run, then down through the middle.
      const uint32_t period = 2 * length - 2;
      const uint32_t at = sequenceIndex_ % period;
      k = at < length ? at : period - at;
    } else {
      k = sequenceIndex_ % length;
    }
    ++sequenceIndex_;
    const uint32_t octave = k / heldCount_;
    const uint32_t which = k % heldCount_;
    Held h;
    if (mode == AsPlayed || mode == Random) h = held_[which];
    else if (mode == Down) h = sorted_[heldCount_ - 1 - which];
    else h = sorted_[which];
    h.pitch = std::min(127.f, h.pitch + 12.f * static_cast<float>(octave));
    return h;
  }

  void press(float pitch, float velocity) {
    for (uint32_t k = 0; k < heldCount_; ++k) {
      if (held_[k].pitch != pitch) continue;
      held_[k].velocity = velocity;   // a repeated press keeps its place and takes the new velocity
      resort();
      return;
    }
    if (heldCount_ == kMaxHeld) {   // drop the oldest, so the newest notes are the ones that play
      for (uint32_t k = 1; k < kMaxHeld; ++k) held_[k - 1] = held_[k];
      --heldCount_;
    }
    held_[heldCount_++] = Held{pitch, velocity};
    resort();
  }

  void release(float pitch) {
    for (uint32_t k = heldCount_; k > 0; --k) {
      if (held_[k - 1].pitch != pitch) continue;
      for (uint32_t j = k; j < heldCount_; ++j) held_[j - 1] = held_[j];
      --heldCount_;
      resort();
      return;
    }
  }

  /// `sorted_` is `held_` by pitch, rebuilt on every change. Insertion sort over at most 32 notes.
  void resort() {
    for (uint32_t k = 0; k < heldCount_; ++k) {
      Held h = held_[k];
      uint32_t j = k;
      while (j > 0 && sorted_[j - 1].pitch > h.pitch) { sorted_[j] = sorted_[j - 1]; --j; }
      sorted_[j] = h;
    }
  }

  void stopSounding(uint32_t frame) {
    if (!sounding_) return;
    if (record(noteOff(frame, soundingPitch_, soundingId_))) sounding_ = false;
  }

  std::array<Held, kMaxHeld> held_{};     // in the order they were pressed
  std::array<Held, kMaxHeld> sorted_{};   // the same, by pitch
  uint32_t heldCount_ = 0;
  uint32_t sequenceIndex_ = 0;
  bool sounding_ = false;
  float soundingPitch_ = 0.f;
  uint32_t soundingId_ = 0;
  double gateEnd_ = 0.0;
  int64_t lastStep_ = 0;
  double lastPos_ = 0.0;
  bool haveLast_ = false;
  notefx::Rng rng_;
};

}  // namespace

const ModuleDescriptor& noteFxArp() {
  static const ModuleDescriptor d{kModuleAbiVersion, "notefx.arp", "Arpeggiator", "Note FX",
    "Plays whatever notes are held one at a time, on a grid locked to the transport: hold a chord and "
    "hear it climb. Rate sets the step, Mode the order (up, down, both ways, as played, at random), "
    "Octaves how far the run climbs before it repeats, and Gate how much of each step the note holds. "
    "Stopped, it runs at the project tempo; playing, it follows the playhead exactly.",
    kIn, countOf(kIn), kOut, countOf(kOut), kParams, countOf(kParams), kModuleNeedsTransport, 0,
    [] () -> Module* { return new NoteFxArp(); }, kFace, countOf(kFace)};
  return d;
}

}  // namespace pg::modules

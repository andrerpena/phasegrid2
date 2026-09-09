#include <algorithm>
#include <cstdint>
#include <iterator>
#include "core/Module.hpp"
#include "modules/NoteFx.hpp"

namespace pg::modules {
namespace {

using notefx::HeldNote;

const PortDesc kIn[] = {
  {"notes", "Notes", PortKind::Event, 0, SignalRole::Note, "The notes to build chords on: each one becomes the root"},
};
const PortDesc kOut[] = {
  {"notes", "Notes", PortKind::Event, 0, SignalRole::Note, "The chords: one note on per chord tone for every note that comes in"},
};

const char* kChordLabels[] = {"Major", "Minor", "Diminished", "Augmented", "Sus2", "Sus4", "Major 7", "Minor 7", "Dominant 7"};
constexpr int8_t kNone = -1;
/// Semitones above the root, one row per label. -1 pads a triad.
const int8_t kIntervals[][notefx::kMaxOutPerNote] = {
  {0, 4, 7, kNone},   // major
  {0, 3, 7, kNone},   // minor
  {0, 3, 6, kNone},   // diminished
  {0, 4, 8, kNone},   // augmented
  {0, 2, 7, kNone},   // sus2
  {0, 5, 7, kNone},   // sus4
  {0, 4, 7, 11},      // major 7
  {0, 3, 7, 10},      // minor 7
  {0, 4, 7, 10},      // dominant 7
};
static_assert(std::size(kIntervals) == std::size(kChordLabels));

const ParamDesc kParams[] = {
  {"chord", "Chord", 0.f, static_cast<float>(std::size(kChordLabels) - 1), 0.f, ParamUnit::None,
   ParamCurve::Linear, kParamEnum | kParamInteger | kParamNoSmooth, kChordLabels, countOf(kChordLabels),
   "select", nullptr, "Which chord every incoming note becomes the root of"},
};

/// Notes that may be held at once. A chord is released by the same off that would have released
/// its root, so this is a count of incoming notes, not of chord tones.
constexpr uint32_t kMaxHeld = 64;

/// One note in, a chord out.
///
/// The chord is fixed at the note ON: the off releases the tones the on produced (`HeldTable`), so
/// changing the chord type under a held note does not leave any of its tones sounding. A tone that
/// clamps onto another -- a 7th at the top of the range -- is dropped rather than doubled, because two
/// note ons at one pitch would need two offs and only one is coming.
class NoteFxChord final : public notefx::NoteFxModule {
  void advance(const ProcessContext& c) override {
    const int chord = std::clamp(static_cast<int>(lanes::lane(c.param(0).at(0), 0)), 0,
                                 static_cast<int>(std::size(kIntervals)) - 1);
    for (const Event& e : c.eventIn(0)) {
      if (e.frame >= c.numFrames) continue;
      if (e.type == EventType::NoteOn) {
        HeldNote h;
        h.in = e.a;
        h.id = e.noteId;
        for (const int8_t interval : kIntervals[chord]) {
          if (interval == kNone) break;
          const float pitch = std::clamp(e.a + static_cast<float>(interval), 0.f, 127.f);
          bool duplicate = false;
          for (uint32_t k = 0; k < h.count; ++k) duplicate = duplicate || h.out[k] == pitch;
          if (duplicate) continue;
          const Event on = noteOn(e.frame, pitch, e.b);
          if (!record(on)) break;
          h.out[h.count] = pitch;
          h.outId[h.count] = on.noteId;
          ++h.count;
        }
        // A note the table cannot hold is released at once rather than left sounding forever.
        if (h.count > 0 && !held_.add(h))
          for (uint32_t k = 0; k < h.count; ++k) record(noteOff(e.frame, h.out[k], h.outId[k]));
      } else if (e.type == EventType::NoteOff) {
        HeldNote h;
        if (!held_.take(e.a, h)) continue;   // an off for a note we never saw the on of
        for (uint32_t k = 0; k < h.count; ++k) record(noteOff(e.frame, h.out[k], h.outId[k]));
      } else {
        record(e);   // pressure and expression pass through untouched
      }
    }
  }

  notefx::HeldTable<kMaxHeld> held_;
};

}  // namespace

const ModuleDescriptor& noteFxChord() {
  static const ModuleDescriptor d{kModuleAbiVersion, "notefx.chord", "Chord", "Note FX",
    "Turns every note into a chord with that note as its root: a major triad, a minor one, a seventh. "
    "The chord is fixed when the note starts, so changing the type under a held note releases the "
    "tones that were sounding. Raise the project's voice count so the tones play as a chord rather "
    "than as one note after another.",
    kIn, countOf(kIn), kOut, countOf(kOut), kParams, countOf(kParams), 0, 0,
    [] () -> Module* { return new NoteFxChord(); }, nullptr, 0};
  return d;
}

}  // namespace pg::modules

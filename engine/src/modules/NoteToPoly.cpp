#include <cstdint>
#include <vector>
#include "core/Module.hpp"

namespace pg::modules {
namespace {

const PortDesc kIn[] = {
  {"notes", "Notes", PortKind::Event, 0, SignalRole::Note, "Note events to spread across the program's voices"},
};
const PortDesc kOut[] = {
  {"pitch", "Pitch", PortKind::Continuous, 1, SignalRole::Pitch, "Pitch of each voice's note, 0.1 per octave from middle C"},
  {"gate", "Gate", PortKind::Continuous, 1, SignalRole::Gate, "1 while that voice holds a note; drops for one frame when the voice is stolen"},
  {"velocity", "Velocity", PortKind::Continuous, 1, SignalRole::Cv, "Velocity of the note each voice is playing, 0..1"},
};

/// The allocator's view of one voice. Written only while pair 0 assigns the block's events, so it ends a
/// block in the state the next block's allocation must start from.
struct Slot {
  float note = kMiddleCMidi;
  bool sounding = false;
  uint64_t age = 0;   // note-on order; the oldest sounding voice is the one a steal takes
};

/// One assignment the allocator made, replayed by the pair that owns the voice.
struct Change {
  uint32_t frame = 0;
  uint32_t voice = 0;
  float note = kMiddleCMidi;
  float velocity = 0.f;
  bool on = false;
  bool retrigger = false;   // gate low for exactly this frame, so a downstream envelope sees an edge
};

/// What a voice is emitting right now. Touched only by the pair that owns the voice, which is what lets it
/// survive pair 0 having already run the whole block's allocation ahead of the later pairs.
struct Out {
  float pitch = 0.f;
  float velocity = 0.f;
  bool gate = false;
};

/// Voice allocation for a whole program. The voice table is per *program*, not per pair, so it is built here
/// rather than in a `VoicedModule` state: pair 0 runs the block's allocation and every pair then replays the
/// resulting change list for the two voices its lanes carry (see the scheduler contract in docs/engine.md).
class NoteToPoly final : public Module {
public:
  void prepare(const PrepareInfo& p) override {
    voices_ = p.voiceCount;
    // 2 * voicePairs entries: an odd voice count leaves the top lane of the last pair without a voice, and
    // sizing to the lanes keeps every index the pairs use in range. Allocation still stops at `voices_`, so
    // that lane never gets a note the terminal would only mask away again.
    slots_.assign(2 * ((p.voiceCount + 1) / 2), Slot{});
    out_.assign(slots_.size(), Out{});
    changes_.assign(kMaxEventsPerBlock, Change{});   // one input event produces at most one change
    changeCount_ = 0;
    nextAge_ = 1;
  }

  void reset(uint32_t voicePair) override {
    for (uint32_t v = 2 * voicePair; v < 2 * voicePair + 2 && v < slots_.size(); ++v) {
      slots_[v] = Slot{};
      out_[v] = Out{};
    }
    changeCount_ = 0;
  }

  void process(ProcessContext& c) override {
    if (c.voice == 0) allocate(c);   // per-block work runs on pair 0; the events are the same for every pair

    const uint32_t first = 2 * c.voice;
    Sample* pitchOut = c.out(0).data;
    Sample* gateOut = c.out(1).data;
    Sample* velocityOut = c.out(2).data;

    uint32_t cursor[2] = {0, 0};   // one cursor per lane, each walking the shared change list monotonically
    for (uint32_t i = 0; i < c.numFrames; ++i) {
      bool dip[2] = {false, false};
      for (uint32_t l = 0; l < 2; ++l) {
        const uint32_t v = first + l;
        while (cursor[l] < changeCount_ && changes_[cursor[l]].frame <= i) {
          const Change& ch = changes_[cursor[l]++];
          if (ch.voice != v) continue;
          out_[v].gate = ch.on;
          if (ch.on) { out_[v].pitch = midiNoteToPitch(ch.note); out_[v].velocity = ch.velocity; }
          dip[l] = dip[l] || ch.retrigger;
        }
      }
      const Out& a = out_[first];
      const Out& b = out_[first + 1];
      const float gateA = a.gate && !dip[0] ? 1.f : 0.f;
      const float gateB = b.gate && !dip[1] ? 1.f : 0.f;
      pitchOut[i] = Sample(a.pitch, a.pitch, b.pitch, b.pitch) & c.voiceMask;
      gateOut[i] = Sample(gateA, gateA, gateB, gateB) & c.voiceMask;
      velocityOut[i] = Sample(a.velocity, a.velocity, b.velocity, b.velocity) & c.voiceMask;
    }
  }

private:
  /// Turns the block's note events into voice assignments. Runs once per block, on pair 0.
  void allocate(const ProcessContext& c) {
    changeCount_ = 0;
    for (const Event& e : c.eventIn(0)) {
      if (e.frame >= c.numFrames || changeCount_ == changes_.size()) continue;
      if (e.type == EventType::NoteOn) {
        const uint32_t v = pickVoice();
        // Taking a voice that is still sounding drops its gate for exactly this frame, so a downstream
        // envelope retriggers instead of gliding the stolen voice to the new pitch at its sustain level.
        changes_[changeCount_++] = Change{e.frame, v, e.a, e.b, true, slots_[v].sounding};
        slots_[v] = Slot{e.a, true, nextAge_++};
      } else if (e.type == EventType::NoteOff) {
        const int32_t v = findSounding(e.a);
        if (v < 0) continue;   // the note was stolen while it was held: its voice belongs to someone else now
        const uint32_t voice = static_cast<uint32_t>(v);
        changes_[changeCount_++] = Change{e.frame, voice, slots_[voice].note, 0.f, false, false};
        slots_[voice].sounding = false;
      }
    }
  }

  /// The lowest-numbered free voice, or, with all of them sounding, the one that started longest ago.
  uint32_t pickVoice() const {
    for (uint32_t v = 0; v < voices_; ++v)
      if (!slots_[v].sounding) return v;
    uint32_t oldest = 0;
    for (uint32_t v = 1; v < voices_; ++v)
      if (slots_[v].age < slots_[oldest].age) oldest = v;
    return oldest;
  }

  /// The oldest sounding voice playing `note`, or -1. Matching on the note means a note-off for a note that
  /// was already stolen finds nothing and cuts no one else short.
  int32_t findSounding(float note) const {
    int32_t best = -1;
    for (uint32_t v = 0; v < voices_; ++v) {
      if (!slots_[v].sounding || slots_[v].note != note) continue;
      if (best < 0 || slots_[v].age < slots_[static_cast<uint32_t>(best)].age) best = static_cast<int32_t>(v);
    }
    return best;
  }

  std::vector<Slot> slots_;
  std::vector<Out> out_;
  std::vector<Change> changes_;
  uint32_t changeCount_ = 0;
  uint32_t voices_ = 1;
  uint64_t nextAge_ = 1;
};

}  // namespace

// Explicit `extern` (see AudioOut.cpp): a namespace-scope `const` is internal linkage by default.
extern const ModuleDescriptor kNoteToPoly{kModuleAbiVersion, "note.toPoly", "Note to Poly", "note",
  "Spreads note events across the program's voices: each output carries a different value per voice lane. A "
  "note takes a free voice, or steals the one that has been sounding longest, and releases its voice on the "
  "matching note off.",
  kIn, countOf(kIn), kOut, countOf(kOut), nullptr, 0, 0, 0,
  [] () -> Module* { return new NoteToPoly(); }};

}  // namespace pg::modules

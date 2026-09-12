#pragma once
/// What every note effect shares: a module with a note stream in and a different note stream out.
///
/// Three things are the same for all of them and are kept here so each module is only about what it
/// does to the notes:
///
/// - The per-pair contract. An event buffer is cleared and refilled once per voice pair, and the note
///   stream is the same for every voice, so the block's events are worked out once, on pair 0, and
///   pushed again for every pair (the shape `notes.clip` and `notes.pattern` follow).
/// - The release rule. The converters downstream (`note.toCv`, `note.toPoly`) match a note off to its
///   note on BY PITCH, so an effect that changes a pitch, or turns one note into several, has to
///   remember exactly what it emitted for each incoming note and release exactly that when the off
///   arrives. `HeldTable` is that memory, keyed by the incoming pitch.
/// - A random source that is safe on the audio thread. `Rng` is a xorshift with no state but its seed,
///   so a humanised part is the same every time the transport is rewound, which is what a person editing
///   it needs.
#include <array>
#include <cstdint>
#include <vector>
#include "core/Module.hpp"

namespace pg::modules::notefx {

/// xorshift32: four instructions, no allocation, and deterministic from its seed.
class Rng {
public:
  explicit Rng(uint32_t seed = 0x9E3779B9u) : s_(seed == 0 ? 1u : seed) {}
  uint32_t next() {
    s_ ^= s_ << 13;
    s_ ^= s_ >> 17;
    s_ ^= s_ << 5;
    return s_;
  }
  /// Uniform in [0, 1).
  float unit() { return static_cast<float>(next() >> 8) * (1.f / 16777216.f); }
  /// Uniform in [-1, 1).
  float bipolar() { return unit() * 2.f - 1.f; }

private:
  uint32_t s_;
};

/// Most pitches one incoming note may turn into. A four-note chord is the widest thing here.
inline constexpr uint32_t kMaxOutPerNote = 4;

/// An incoming note the effect has answered with a note on and not yet released.
struct HeldNote {
  float in = 0.f;                        // the pitch the note ON carried, which its off will carry too
  uint32_t id = 0;                       // the id of that note on
  std::array<float, kMaxOutPerNote> out{};   // the pitches emitted for it
  std::array<uint32_t, kMaxOutPerNote> outId{};
  uint32_t count = 0;
  uint64_t extra = 0;                    // whatever else the effect needs to release it: a delay, a step
};

/// A fixed-capacity memory of held notes, newest last. Lookup by incoming pitch takes the NEWEST entry,
/// so a repeated press releases its latest press, the way the converters' own stacks do.
template <uint32_t N>
class HeldTable {
public:
  bool add(const HeldNote& n) {
    if (count_ == N) return false;
    notes_[count_++] = n;
    return true;
  }
  /// Removes the newest entry for `in` into `out`. False when nothing is held at that pitch.
  bool take(float in, HeldNote& out) {
    for (uint32_t i = count_; i > 0; --i) {
      if (notes_[i - 1].in != in) continue;
      out = notes_[i - 1];
      erase(i - 1);
      return true;
    }
    return false;
  }
  bool takeAt(uint32_t index, HeldNote& out) {
    if (index >= count_) return false;
    out = notes_[index];
    erase(index);
    return true;
  }
  const HeldNote& at(uint32_t i) const { return notes_[i]; }
  uint32_t size() const { return count_; }
  bool empty() const { return count_ == 0; }
  void clear() { count_ = 0; }

private:
  void erase(uint32_t index) {
    for (uint32_t k = index + 1; k < count_; ++k) notes_[k - 1] = notes_[k];
    --count_;
  }
  std::array<HeldNote, N> notes_{};
  uint32_t count_ = 0;
};

/// The skeleton: `advance` runs once per block on pair 0 and records the block's outgoing events, in
/// frame order, through `record`; `process` then pushes them for every pair.
class NoteFxModule : public Module {
public:
  void prepare(const PrepareInfo& p) final {
    events_.assign(kMaxEventsPerBlock, Event{});
    eventCount_ = 0;
    onPrepare(p);
  }

  void process(ProcessContext& c) final {
    if (c.firstPass) {
      eventCount_ = 0;
      advance(c);
    }
    EventBuffer& out = c.eventOut(0);
    for (uint32_t i = 0; i < eventCount_; ++i) out.push(events_[i]);
  }

protected:
  virtual void onPrepare(const PrepareInfo&) {}
  /// The block's work: read `c.eventIn(0)`, `record` what comes out. Pair 0 only.
  virtual void advance(const ProcessContext& c) = 0;

  /// Appends to the block's outgoing events, or reports that the block is full or the event is out
  /// of order. An event refused here is lost, so an effect that can defer should (see `humanize`).
  bool record(const Event& e) {
    if (eventCount_ == events_.size()) return false;
    if (eventCount_ > 0 && e.frame < events_[eventCount_ - 1].frame) return false;
    events_[eventCount_++] = e;
    return true;
  }

  Event noteOn(uint32_t frame, float pitch, float velocity) {
    Event e;
    e.frame = frame;
    e.type = EventType::NoteOn;
    e.noteId = nextId_++;
    e.a = pitch;
    e.b = velocity;
    return e;
  }

  static Event noteOff(uint32_t frame, float pitch, uint32_t id) {
    Event e;
    e.frame = frame;
    e.type = EventType::NoteOff;
    e.noteId = id;
    e.a = pitch;
    return e;
  }

private:
  std::vector<Event> events_;
  uint32_t eventCount_ = 0;
  uint32_t nextId_ = 1;
};

}  // namespace pg::modules::notefx

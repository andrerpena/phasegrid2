#pragma once
#include <array>
#include <cstdint>
#include <type_traits>
#include "core/Conventions.hpp"

namespace pg {

/// 0..63 core, 64..127 expression, 128+ user/plugin defined.
enum class EventType : uint16_t { NoteOn = 1, NoteOff = 2, NotePressure = 3, NoteExpression = 4, Trigger = 5 };

struct Event {
  uint32_t frame = 0;
  EventType type = EventType::Trigger;
  uint8_t channel = 0;
  uint8_t flags = 0;
  uint32_t noteId = 0;
  float a = 0.f, b = 0.f, c = 0.f;   // NoteOn: pitch (MIDI note), velocity 0..1, detune
};
static_assert(std::is_trivially_copyable_v<Event>);

class EventBuffer {
public:
  bool push(const Event& e) {
    if (count_ == kMaxEventsPerBlock) return false;
    if (count_ > 0 && e.frame < events_[count_ - 1].frame) return false;
    events_[count_++] = e;
    return true;
  }
  void clear() { count_ = 0; }
  uint32_t size() const { return count_; }
  const Event& operator[](uint32_t i) const { return events_[i]; }
  const Event* begin() const { return events_.data(); }
  const Event* end() const { return events_.data() + count_; }
private:
  std::array<Event, kMaxEventsPerBlock> events_{};
  uint32_t count_ = 0;
};

void mergeEvents(const EventBuffer* const* sources, uint32_t numSources, EventBuffer& dst);

}  // namespace pg

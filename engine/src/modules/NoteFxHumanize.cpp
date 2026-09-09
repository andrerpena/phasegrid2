#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include "core/Module.hpp"
#include "modules/NoteFx.hpp"

namespace pg::modules {
namespace {

using notefx::HeldNote;

const PortDesc kIn[] = {
  {"notes", "Notes", PortKind::Event, 0, SignalRole::Note, "The notes to loosen up"},
};
const PortDesc kOut[] = {
  {"notes", "Notes", PortKind::Event, 0, SignalRole::Note, "The same notes, each a little late and a little louder or softer"},
};

const ParamDesc kParams[] = {
  {"timing", "Timing", 0.f, 0.1f, 0.01f, ParamUnit::Seconds, ParamCurve::Linear,
   kParamPrimary | kParamModulatable, nullptr, 0, "knob", nullptr,
   "The most a note may arrive late. Each note is delayed by a random amount up to this, and released the same amount late, so its length is kept"},
  {"velocity", "Velocity", 0.f, 1.f, 0.2f, ParamUnit::Ratio, ParamCurve::Linear,
   kParamPrimary | kParamModulatable, nullptr, 0, "knob", nullptr,
   "How much each note's velocity may wander, either way, as a fraction of itself"},
};

const char* const kFace[] = {
  "in:notes timing timing velocity velocity out:notes",
  ".        timing timing velocity velocity .        ",
};

/// Events waiting to be emitted. A block can carry `kMaxEventsPerBlock` and a delay spans at most a
/// few blocks, so this is generous; when it is full an event goes out at once rather than being lost.
constexpr uint32_t kMaxPending = 512;
constexpr uint32_t kMaxHeld = 64;
/// Quieter than this and a note is a note nobody hears, which is a dropped note, not a soft one.
constexpr float kMinVelocity = 0.01f;

struct Pending {
  uint64_t at = 0;   // engine time, in samples
  Event e;
};

/// The little inaccuracies a person playing adds: notes a touch late, a touch louder or softer.
///
/// Timing is a delay, never an advance -- a module cannot know a note before it arrives -- drawn
/// afresh for each note on and applied to its note off as well, so a note is moved, not shortened
/// or stretched. The pending events are kept in engine time (`samplePos`, which free-runs), sorted
/// as they are added, and drained into each block in order. The random source is seeded once, so
/// rewinding the transport plays the same performance again.
class NoteFxHumanize final : public notefx::NoteFxModule {
  void onPrepare(const PrepareInfo& p) override {
    sampleRate_ = p.sampleRate;
    pendingCount_ = 0;
    held_.clear();
  }

  void advance(const ProcessContext& c) override {
    const uint64_t base = c.transport->samplePos;
    for (const Event& e : c.eventIn(0)) {
      if (e.frame >= c.numFrames) continue;
      const uint64_t now = base + e.frame;
      if (e.type == EventType::NoteOn) {
        const float timing = std::clamp(lanes::lane(c.param(0).at(e.frame), 0), 0.f, 0.1f);
        const float amount = std::clamp(lanes::lane(c.param(1).at(e.frame), 0), 0.f, 1.f);
        const uint64_t delay = static_cast<uint64_t>(std::llround(static_cast<double>(rng_.unit() * timing) * sampleRate_));
        Event on = e;
        on.b = std::clamp(e.b * (1.f + rng_.bipolar() * amount), kMinVelocity, 1.f);
        HeldNote h;
        h.in = e.a;
        h.id = e.noteId;
        h.out[0] = e.a;
        h.outId[0] = e.noteId;
        h.count = 1;
        h.extra = delay;
        if (!held_.add(h)) { enqueue(now, e.frame, e); continue; }   // full: the note goes through untouched
        enqueue(now + delay, e.frame, on);
      } else if (e.type == EventType::NoteOff) {
        HeldNote h;
        const uint64_t delay = held_.take(e.a, h) ? h.extra : 0;
        enqueue(now + delay, e.frame, e);
      } else {
        enqueue(now, e.frame, e);
      }
    }
    drain(base, c.numFrames);
  }

  /// Adds to the sorted queue; equal times keep arrival order. When the queue is full the event is
  /// emitted now, at the frame it arrived, which may be refused if the block has moved past it.
  void enqueue(uint64_t at, uint32_t frame, const Event& e) {
    if (pendingCount_ == kMaxPending) {
      Event now = e;
      now.frame = frame;
      record(now);
      return;
    }
    uint32_t i = pendingCount_;
    while (i > 0 && pending_[i - 1].at > at) { pending_[i] = pending_[i - 1]; --i; }
    pending_[i] = Pending{at, e};
    ++pendingCount_;
  }

  /// Emits everything due within the block. Anything overdue -- the transport does not go backwards
  /// in engine time, but a block can be shorter than the last -- goes out on the first frame.
  void drain(uint64_t base, uint32_t numFrames) {
    uint32_t taken = 0;
    while (taken < pendingCount_) {
      const Pending& p = pending_[taken];
      if (p.at >= base + numFrames) break;
      Event e = p.e;
      e.frame = p.at < base ? 0 : static_cast<uint32_t>(p.at - base);
      if (!record(e)) break;   // the block is full: the rest waits for the next one
      ++taken;
    }
    for (uint32_t k = taken; k < pendingCount_; ++k) pending_[k - taken] = pending_[k];
    pendingCount_ -= taken;
  }

  std::array<Pending, kMaxPending> pending_{};
  uint32_t pendingCount_ = 0;
  notefx::HeldTable<kMaxHeld> held_;
  notefx::Rng rng_;
  double sampleRate_ = 48000.0;
};

}  // namespace

const ModuleDescriptor& noteFxHumanize() {
  static const ModuleDescriptor d{kModuleAbiVersion, "notefx.humanize", "Humanize", "Note FX",
    "Loosens a note stream the way a person playing would: each note arrives a little late, by a random "
    "amount up to Timing, and a little louder or softer, by up to Velocity. A note is moved whole -- its "
    "off is delayed as much as its on -- so lengths are kept. The randomness is the same on every "
    "pass, so a part sounds the way it did last time.",
    kIn, countOf(kIn), kOut, countOf(kOut), kParams, countOf(kParams), kModuleNeedsTransport, 0,
    [] () -> Module* { return new NoteFxHumanize(); }, kFace, countOf(kFace)};
  return d;
}

}  // namespace pg::modules

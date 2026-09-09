#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <string>
#include "core/Module.hpp"
#include "modules/Division.hpp"
#include "services/Telemetry.hpp"
#include "pattern/Mini.hpp"
#include "pattern/Pattern.hpp"

namespace pg::modules {
namespace {

using pattern::Fraction;
using pattern::Hap;
using pattern::TimeSpan;

/// The largest float below 1: `phase` is documented as 0 <= phase < 1, and a double a hair under
/// one rounds UP to exactly 1 when narrowed (the same trap `phase.clock` documents).
constexpr float kJustBelowOne = 0x1.fffffep-1f;

const PortDesc kIn[] = {
  {"play", "Play", PortKind::Continuous, 1, SignalRole::Gate,
   "High runs the pattern; low stops it and releases every note it is holding. Unconnected, it runs"},
};
const PortDesc kOut[] = {
  {"notes", "Notes", PortKind::Event, 0, SignalRole::Note, "Note on and note off events for the steps that are sounding"},
  {"phase", "Phase", PortKind::Continuous, 1, SignalRole::Phase, "Position within the cycle: 0 at its start, just under 1 at its end"},
};

const ParamDesc kParams[] = {
  {"cycle", "Cycle", 0.f, static_cast<float>(kDivisionCount - 1), 4.f, ParamUnit::None,
   ParamCurve::Linear, kParamEnum | kParamInteger | kParamNoSmooth, kDivisionLabels, kDivisionCount,
   "select", nullptr, "How long one cycle of the pattern lasts, in musical time"},
  {"legato", "Legato", 0.01f, 1.f, 0.9f, ParamUnit::Ratio, ParamCurve::Linear,
   kParamPrimary | kParamModulatable, nullptr, 0, "slider", nullptr,
   "How much of its step each note holds. Below 1 there is a gap before the next one"},
  {"transpose", "Transpose", -48.f, 48.f, 0.f, ParamUnit::Semitones, ParamCurve::Linear,
   kParamPrimary | kParamInteger | kParamNoSmooth, nullptr, 0, "slider", nullptr,
   "Semitones added to each note as it starts"},
  // Strudel's name for exactly this: the multiplier that rides alongside a note's velocity.
  {"gain", "Gain", 0.f, 1.f, 1.f, ParamUnit::None, ParamCurve::Linear,
   kParamPrimary | kParamModulatable, nullptr, 0, "slider", nullptr,
   "What every note's velocity is multiplied by. With no Velocity pattern this IS the velocity"},
};

const TextDesc kTexts[] = {
  {"pattern", "Pattern", "c3 e3 g3 b3", 0, "mini", "c3 e3 g3 b3",
   "The notes, in Tidal/Strudel mini-notation. Note names or MIDI numbers, `~` for a rest, `[ ]` to "
   "subdivide a step, `< >` to take one per cycle, `,` to stack, `*` and `/` to speed up and slow "
   "down, `!` to repeat, `@` to lengthen, `( )` for a euclidean rhythm, `?` to drop notes at random "
   "and `|` to choose one. A bare note name is octave 3, so middle C is written `c4`"},
  {"velocity", "Velocity pattern", "", 0, "mini", "1 .5 .8 .3",
   "How hard each note is struck, in the same notation, as numbers from 0 to 1. Each note takes "
   "whichever value is running when it starts, so this need not have the same number of steps as "
   "the notes do. Empty means every note is struck at full velocity, and the Gain knob alone decides"},
};

const char* const kFace[] = {
  "play  text:pattern  text:pattern  text:pattern  text:pattern  text:pattern  text:pattern  notes",
  ".     text:velocity text:velocity text:velocity text:velocity text:velocity text:velocity phase",
  ".     pianoRoll     pianoRoll     pianoRoll     pianoRoll     pianoRoll     pianoRoll     .    ",
  ".     pianoRoll     pianoRoll     pianoRoll     pianoRoll     pianoRoll     pianoRoll     .    ",
  ".     legato        legato        transpose     transpose     gain          gain          .    ",
  ".     legato        legato        transpose     transpose     gain          gain          .    ",
};

/// A note the module has emitted a note on for and not yet a note off.
///
/// Identified by WHERE IN THE CYCLE it starts and which step of the source it came from, rather
/// than by an index into the last query: the query is redone at every cycle boundary, and an index
/// into it would name a different note afterwards. The start is an exact rational, so this is an
/// equality and not a tolerance.
struct Held {
  Fraction start;
  int32_t atom = -1;
  float note = kMiddleCMidi;
  uint32_t id = 0;
};

/// A note source written as a string: Tidal's mini-notation, played against the transport.
///
/// Everything about how the notes are emitted is `notes.clip`'s, deliberately -- the playhead is
/// DERIVED from the transport rather than accumulated, so an edit to the pattern rebuilds the
/// instance (node data is structural) and it lands where the old one was; the block's events are
/// worked out once on pair 0 and replayed for every pair; and a note off is how a note leaves the
/// sounding set, so no note on can lose one. What is new is only where the notes come from.
class NotesPattern final : public Module {
public:
  void configure(const ParamValues&, const NodeData& data) override {
    std::string error;
    // A pattern that will not parse plays NOTHING, rather than half of itself. Same rule as a
    // malformed clip: a loud silence is a bug you can see, a half-read pattern is one you cannot.
    if (!pattern::parseMini(textProperty(data, "pattern", kTexts[0].def), pattern::AtomMode::Note,
                            notes_, error))
      notes_ = pattern::Program{};
    if (!pattern::parseMini(textProperty(data, "velocity", kTexts[1].def),
                            pattern::AtomMode::Number, velocities_, error))
      velocities_ = pattern::Program{};
  }

  void prepare(const PrepareInfo&) override {
    held_.assign(pattern::kMaxHapsPerQuery, Held{});
    events_.assign(kMaxEventsPerBlock, Event{});
    noteHaps_.assign(pattern::kMaxHapsPerQuery, Hap{});
    velocityHaps_.assign(pattern::kMaxHapsPerQuery, Hap{});
    published_.assign(kTelemetryMaxNotes, TelemetryNote{});
    heldCount_ = 0;
    eventCount_ = 0;
    noteCount_ = 0;
    velocityCount_ = 0;
    haveCached_ = false;
    haveLast_ = false;
    lastPos_ = 0.0;
  }

  void process(ProcessContext& c) override {
    if (c.voice == 0) {
      advance(c);   // per-block work runs on pair 0; the notes are the same for every voice
      publish(c);
    }

    EventBuffer& out = c.eventOut(0);
    for (uint32_t i = 0; i < eventCount_; ++i) out.push(events_[i]);
    Sample* phaseOut = c.out(1).data;
    for (uint32_t i = 0; i < c.numFrames; ++i) phaseOut[i] = Sample(phase_[i]);
  }

private:
  /// Draws the module's own picture of what it is playing: the cycle's notes, where the playhead is
  /// in it, and the meter to rule a grid under them.
  ///
  /// Published from here rather than worked out by the interface, because the interface cannot: it
  /// would have to parse mini-notation to know where the notes are, and the module has already done
  /// that. So the face's piano roll is fed the same notes the note stream is.
  void publish(const ProcessContext& c) {
    if (c.telemetry == nullptr || c.telemetrySlot == kNoTelemetrySlotCtx) return;
    const TransportSnapshot& t = *c.transport;
    const float transpose = lanes::lane(c.param(2).at(0), 0);
    const float knob = std::clamp(lanes::lane(c.param(3).at(0), 0), 0.f, 1.f);
    const float legato = std::clamp(lanes::lane(c.param(1).at(0), 0), 0.01f, 1.f);
    const double base = static_cast<double>(cachedCycle_);

    uint32_t count = 0;
    for (uint32_t i = 0; i < noteCount_ && count < kTelemetryMaxNotes; ++i) {
      const Hap& hap = noteHaps_[i];
      const double begin = hap.whole.begin.toDouble() - base;
      const double width = hap.whole.end.toDouble() - hap.whole.begin.toDouble();
      TelemetryNote& out = published_[count++];
      out.start = static_cast<float>(begin);
      out.length = static_cast<float>(width * static_cast<double>(legato));
      out.pitch = std::clamp(hap.value + transpose, 0.f, 127.f);
      out.velocity = std::clamp(velocityAt(hap) * knob, 0.f, 1.f);
      out.from = hap.atom >= 0 ? notes_.atoms[static_cast<size_t>(hap.atom)].from : 0;
      out.to = hap.atom >= 0 ? notes_.atoms[static_cast<size_t>(hap.atom)].to : 0;
      out.textIndex = 0;   // the atoms of a note hap are always in the `pattern` property
      out.flags = isHeld(hap) ? kTelemetryNoteFlagSounding : 0u;
    }
    const double quarters =
      quartersPerCycle(static_cast<uint32_t>(lanes::lane(c.param(0).at(0), 0)), t);
    c.telemetry->writeNotes(c.telemetrySlot, published_.data(), count, static_cast<float>(quarters),
                            static_cast<float>(t.quartersPerBar()),
                            phase_[c.numFrames == 0 ? 0 : c.numFrames - 1], block_++);
  }

  /// Walks the playhead across the block and records the events it crosses. Runs once per block.
  void advance(const ProcessContext& c) {
    eventCount_ = 0;
    const TransportSnapshot& t = *c.transport;
    const double quarters = quartersPerCycle(static_cast<uint32_t>(lanes::lane(c.param(0).at(0), 0)), t);
    const double quartersPerSample = (t.tempo > 0.0 ? t.tempo : 120.0) / (60.0 * c.sampleRate);
    // Playing, the pattern follows the host's musical position exactly. Stopped, it free-runs off
    // the sample position at the transport tempo, the way `phase.clock` and `notes.clip` do, so a
    // patch keeps playing with nothing rolling -- which is also what `--render` gives it.
    const double startQuarters = t.playing ? t.ppq : static_cast<double>(t.samplePos) * quartersPerSample;
    const double cyclesPerSample = quarters > 0.0 ? quartersPerSample / quarters : 0.0;
    const double blockStart = quarters > 0.0 ? startQuarters / quarters : 0.0;

    const float transpose = lanes::lane(c.param(2).at(0), 0);
    const bool alwaysOn = c.in(0).empty();
    const Sample* play = c.in(0).readOr();

    for (uint32_t i = 0; i < c.numFrames; ++i) {
      const double position = blockStart + static_cast<double>(i) * cyclesPerSample;
      const double cycle = std::floor(position);
      phase_[i] = phaseOf(position - cycle);

      if (!(alwaysOn || gateHigh(lanes::lane(play[i], 0)))) {
        releaseAll(i);
        haveLast_ = false;   // a restart is a fresh evaluation, not a jump backwards from here
        continue;
      }
      // The playhead moved backwards -- the transport jumped. Releasing everything first is what
      // retriggers a note the set difference alone would hold across the seam.
      if (haveLast_ && position < lastPos_) releaseAll(i);
      lastPos_ = position;
      haveLast_ = true;

      cacheCycle(static_cast<int64_t>(cycle));
      const float legato = std::clamp(lanes::lane(c.param(1).at(i), 0), 0.01f, 1.f);
      const float velocity = std::clamp(lanes::lane(c.param(3).at(i), 0), 0.f, 1.f);
      release(i, position, legato);
      start(i, position, legato, transpose, velocity);
    }
  }

  static float phaseOf(double within) {
    const float phase = static_cast<float>(std::clamp(within, 0.0, 1.0));
    return phase >= 1.f ? kJustBelowOne : phase;
  }

  /// The cycle's events, queried once when the playhead enters it.
  ///
  /// This is the only work the pattern engine does on the audio thread, and it happens at a cycle
  /// boundary rather than per block or per frame. The query allocates nothing (see `Pattern.hpp`);
  /// what it writes into was allocated in `prepare`.
  void cacheCycle(int64_t cycle) {
    if (haveCached_ && cachedCycle_ == cycle) return;
    const TimeSpan span(Fraction(cycle), Fraction(cycle + 1));
    bool overflowed = false;
    noteCount_ = pattern::query(notes_, span, noteHaps_.data(), pattern::kMaxHapsPerQuery, overflowed);
    velocityCount_ =
      pattern::query(velocities_, span, velocityHaps_.data(), pattern::kMaxHapsPerQuery, overflowed);
    cachedCycle_ = cycle;
    haveCached_ = true;
  }

  /// Is this step sounding at `position`? A step holds `legato` of its own width, so at anything
  /// below 1 there is a gap for the next note to start in.
  static bool covers(const Hap& hap, double position, float legato) {
    const double begin = hap.whole.begin.toDouble();
    const double end = begin + (hap.whole.end.toDouble() - begin) * static_cast<double>(legato);
    return position >= begin && position < end;
  }

  void releaseAll(uint32_t frame) {
    uint32_t keep = 0;
    for (uint32_t k = 0; k < heldCount_; ++k) {
      if (!emitOff(frame, held_[k])) held_[keep++] = held_[k];
    }
    heldCount_ = keep;
  }

  /// Note off for every held note the playhead has left.
  void release(uint32_t frame, double position, float legato) {
    uint32_t keep = 0;
    for (uint32_t k = 0; k < heldCount_; ++k) {
      const Held h = held_[k];
      bool covered = false;
      for (uint32_t i = 0; i < noteCount_; ++i) {
        const Hap& hap = noteHaps_[i];
        if (hap.atom != h.atom || !(hap.whole.begin == h.start)) continue;
        covered = covers(hap, position, legato);
        break;
      }
      if (!covered && emitOff(frame, h)) continue;
      held_[keep++] = h;   // still sounding, or the block is out of events and it goes next block
    }
    heldCount_ = keep;
  }

  /// Note on for every step the playhead has just entered.
  void start(uint32_t frame, double position, float legato, float transpose, float knob) {
    for (uint32_t i = 0; i < noteCount_; ++i) {
      const Hap& hap = noteHaps_[i];
      if (!covers(hap, position, legato)) continue;
      // Anything the playhead is inside and is not already holding starts, onset or not. A note
      // that spans a cycle boundary is already held, so it does not retrigger; a transport seek
      // into the middle of one starts it late, which is what a sequencer should do.
      if (isHeld(hap)) continue;
      if (heldCount_ == held_.size()) return;
      Event e;
      e.frame = frame;
      e.type = EventType::NoteOn;
      e.noteId = nextId_++;
      e.a = std::clamp(hap.value + transpose, 0.f, 127.f);
      e.b = std::clamp(velocityAt(hap) * knob, 0.f, 1.f);
      if (!record(e)) return;
      held_[heldCount_++] = Held{hap.whole.begin, hap.atom, e.a, e.noteId};
    }
  }

  bool isHeld(const Hap& hap) const {
    for (uint32_t k = 0; k < heldCount_; ++k)
      if (held_[k].atom == hap.atom && held_[k].start == hap.whole.begin) return true;
    return false;
  }

  /// The velocity pattern's value where this note starts.
  ///
  /// The note's own structure decides -- the velocity pattern is only asked what it is showing at
  /// that instant, which is Strudel's `appLeft` and why `"c e g".velocity("1 .5")` is three notes
  /// and not two. With no velocity pattern the knob alone decides.
  float velocityAt(const Hap& note) const {
    if (velocityCount_ == 0) return 1.f;
    const Fraction at = note.whole.begin;
    for (uint32_t i = 0; i < velocityCount_; ++i) {
      const Hap& v = velocityHaps_[i];
      if (at >= v.part.begin && at < v.part.end) return std::clamp(v.value, 0.f, 1.f);
    }
    return 1.f;
  }

  bool emitOff(uint32_t frame, const Held& h) {
    Event e;
    e.frame = frame;
    e.type = EventType::NoteOff;
    e.noteId = h.id;
    e.a = h.note;   // the number the note ON used, so a transpose under a held note releases the right one
    return record(e);
  }

  /// Appends to the block's event list, or reports that it is full. A refused event leaves the
  /// held set describing exactly what HAS been emitted, so the next block emits the rest.
  bool record(const Event& e) {
    if (eventCount_ == events_.size()) return false;
    events_[eventCount_++] = e;
    return true;
  }

  pattern::Program notes_;
  pattern::Program velocities_;
  std::vector<Hap> noteHaps_;
  std::vector<Hap> velocityHaps_;
  std::vector<Held> held_;
  std::vector<Event> events_;
  std::vector<TelemetryNote> published_;
  std::array<float, kMaxBlockSize> phase_{};
  uint32_t noteCount_ = 0;
  uint32_t velocityCount_ = 0;
  uint32_t heldCount_ = 0;
  uint32_t eventCount_ = 0;
  uint32_t nextId_ = 1;
  int64_t cachedCycle_ = 0;
  bool haveCached_ = false;
  double lastPos_ = 0.0;
  bool haveLast_ = false;
  uint64_t block_ = 0;
};

}  // namespace

extern const ModuleDescriptor kNotesPattern{kModuleAbiVersion, "notes.pattern", "Pattern", "note",
  "A note source written as a string, in the mini-notation TidalCycles invented and Strudel "
  "carries: `<c4 eb4> g3*2 [~ bb3]` is a whole musical idea in a text field. The pattern is "
  "played against the transport, one cycle at a time, and comes out as a note stream. A second "
  "string patterns the velocity, aligned to the notes rather than to itself. A pattern that will "
  "not parse plays nothing rather than half of itself.",
  kIn, countOf(kIn), kOut, countOf(kOut), kParams, countOf(kParams),
  kModuleNeedsTransport | kModuleWritesTelemetry | kModulePublishesNotes, 1,
  [] () -> Module* { return new NotesPattern(); }, kFace, countOf(kFace), kTexts, countOf(kTexts)};

}  // namespace pg::modules

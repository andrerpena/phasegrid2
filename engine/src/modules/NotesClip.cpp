#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <nlohmann/json.hpp>
#include <vector>
#include "core/Module.hpp"

namespace pg::modules {
namespace {

/// Notes one clip may hold. The playhead re-derives the sounding set every frame (see `advance`), so the
/// per-block cost is O(frames x notes); this cap is what keeps that bounded. A clip with more notes than
/// this is rejected whole rather than truncated, so the loss is loud instead of silent.
constexpr uint32_t kMaxNotes = 512;

/// The largest float below 1: `phase` is documented as 0 <= phase < 1 while the clip is running, and a
/// double a hair under one rounds UP to exactly 1 when narrowed (the same trap `phase.clock` documents).
constexpr float kJustBelowOne = 0x1.fffffep-1f;

const PortDesc kIn[] = {
  {"play", "Play", PortKind::Continuous, 1, SignalRole::Gate,
   "High runs the clip; low stops it and releases every note it is holding. Unconnected, the clip runs"},
};
const PortDesc kOut[] = {
  {"notes", "Notes", PortKind::Event, 0, SignalRole::Note, "Note on and note off events for the notes the playhead is over"},
  {"phase", "Phase", PortKind::Continuous, 1, SignalRole::Phase, "Playhead over the clip: 0 at its start, just under 1 at its end"},
};

const ParamDesc kParams[] = {
  {"length", "Length", 0.f, 256.f, 4.f, ParamUnit::None, ParamCurve::Linear, kParamNoSmooth, nullptr, 0,
   "slider", nullptr, "How long the clip is, in beats. Zero is a clip that never plays"},
  {"loop", "Loop", 0.f, 1.f, 1.f, ParamUnit::None, ParamCurve::Linear, kParamInteger | kParamNoSmooth, nullptr, 0,
   "toggle", nullptr, "Repeat from the start at the end of the clip, rather than playing it once"},
  {"transpose", "Transpose", -48.f, 48.f, 0.f, ParamUnit::Semitones, ParamCurve::Linear,
   kParamPrimary | kParamInteger | kParamNoSmooth, nullptr, 0, "slider", nullptr,
   "Semitones added to each note as it starts"},
};

/// One note of the clip, in beats from the clip's start. Built once, on the message thread.
struct ClipNote {
  double start = 0.0;
  double end = 0.0;        // start + length; the playhead sounds the note over [start, end)
  float pitch = kMiddleCMidi;
  float velocity = 1.f;
};

/// A note the clip has emitted a note on for and not yet a note off. It carries the note number and id the
/// note ON used, so the off matches even if `transpose` has moved since -- otherwise a transpose under a
/// held note would release a note nobody is playing and leave the real one sounding forever.
struct Held {
  uint32_t index = 0;
  float note = kMiddleCMidi;
  uint32_t id = 0;
};

/// Reads a finite number out of a JSON object without throwing on a missing key or a wrong type.
bool readNumber(const nlohmann::json& j, const char* key, double& out) {
  const auto it = j.find(key);
  if (it == j.end() || !it->is_number()) return false;
  out = it->get<double>();
  return std::isfinite(out);
}

/// The clip's notes, out of `data["notes"]`. Anything malformed yields an EMPTY clip rather than a throw or
/// a partial read: `configure` runs on the message thread inside a compile, and half-loading a clip whose
/// JSON has a typo in it would be a silent wrong answer. Missing `notes` is not malformed -- a clip with no
/// notes yet is the normal state of a freshly placed one.
std::vector<ClipNote> parseNotes(const NodeData& data) {
  std::vector<ClipNote> notes;
  try {
    if (!data.is_object()) return notes;
    const auto array = data.find("notes");
    if (array == data.end()) return notes;
    if (!array->is_array() || array->size() > kMaxNotes) return {};
    notes.reserve(array->size());
    for (const auto& j : *array) {
      if (!j.is_object()) return {};
      double start = 0.0, length = 0.0, pitch = 0.0, velocity = 0.0;
      if (!readNumber(j, "start", start) || !readNumber(j, "length", length) ||
          !readNumber(j, "pitch", pitch) || !readNumber(j, "velocity", velocity))
        return {};
      // A zero-length note would never be observed: the playhead only ever samples whole frames, so a note
      // that starts and ends between two of them is a note the clip can never sound.
      if (start < 0.0 || length <= 0.0 || pitch < 0.0 || pitch > 127.0 || velocity < 0.0 || velocity > 1.0) return {};
      notes.push_back(ClipNote{start, start + length, static_cast<float>(pitch), static_cast<float>(velocity)});
    }
  } catch (const nlohmann::json::exception&) {
    return {};   // backstop: no accessor above can throw, but this runs on the message thread inside a compile
  }
  // Sorted by start so `start()` can stop at the first note the playhead has not reached. Stable, so notes
  // that begin together keep the order they were authored in and a chord's events come out in that order.
  std::stable_sort(notes.begin(), notes.end(), [](const ClipNote& a, const ClipNote& b) { return a.start < b.start; });
  return notes;
}

/// A note source that lives on the grid: a list of notes in musical time, played against the transport.
///
/// The playhead is DERIVED from the transport every block rather than accumulated, which is what makes the
/// notes affordable as structural node data -- an instance rebuilt around an edited note list resumes
/// exactly where the old one was (see the node data section of docs/engine.md).
///
/// The block's events are worked out once, on pair 0, and replayed for every pair, per the scheduler
/// contract: the note stream is the same for every voice, and the event buffer is cleared and refilled
/// once per pair.
class NotesClip final : public Module {
public:
  void configure(const ParamValues&, const NodeData& data) override { notes_ = parseNotes(data); }

  void prepare(const PrepareInfo&) override {
    sounding_.assign(notes_.size(), 0);
    held_.assign(notes_.size(), Held{});   // a note can be held only once, so its own count is the ceiling
    events_.assign(kMaxEventsPerBlock, Event{});
    heldCount_ = 0;
    eventCount_ = 0;
    haveLast_ = false;
    lastPos_ = 0.0;
  }

  void process(ProcessContext& c) override {
    if (c.voice == 0) advance(c);   // per-block work runs on pair 0; the notes are the same for every voice

    EventBuffer& out = c.eventOut(0);
    for (uint32_t i = 0; i < eventCount_; ++i) out.push(events_[i]);
    Sample* phaseOut = c.out(1).data;
    for (uint32_t i = 0; i < c.numFrames; ++i) phaseOut[i] = Sample(phase_[i]);
  }

private:
  /// Walks the playhead across the block and records the events it crosses. Runs once per block, on pair 0.
  ///
  /// Every frame re-derives the set of notes the playhead is inside and emits the difference against what is
  /// currently sounding. That is deliberately one code path for cases that would otherwise each need their
  /// own: a transport jump, a loop wrap, the play gate falling and a note simply ending are all just the set
  /// changing, and none of them can leave a note on without its note off, because the note off IS how a note
  /// leaves the set.
  void advance(const ProcessContext& c) {
    eventCount_ = 0;
    const TransportSnapshot& t = *c.transport;
    const double beatsPerSample = (t.tempo > 0.0 ? t.tempo : 120.0) / (60.0 * c.sampleRate);
    // Playing, the clip follows the host's musical position exactly. Stopped, it free-runs off the sample
    // position at the transport tempo, the way `phase.clock` does, so a patch keeps playing with nothing
    // rolling -- which is also what `--render` gives it, since an offline render has no transport.
    const double blockStart = t.playing ? t.ppq : static_cast<double>(t.samplePos) * beatsPerSample;
    const double length = static_cast<double>(lanes::lane(c.param(0).at(0), 0));
    const bool loop = lanes::lane(c.param(1).at(0), 0) > 0.5f;
    const float transpose = lanes::lane(c.param(2).at(0), 0);

    // Nothing plugged into `play` runs the clip, so a clip is audible the moment it is placed. Reading a
    // silent unconnected input instead would leave it permanently stopped with no way to tell why.
    const bool alwaysOn = c.in(0).empty();
    const Sample* play = c.in(0).readOr();

    for (uint32_t i = 0; i < c.numFrames; ++i) {
      const double beats = blockStart + static_cast<double>(i) * beatsPerSample;
      double pos = beats;
      bool running = length > 0.0;
      if (running && loop) {
        pos = std::fmod(beats, length);
        if (pos < 0.0) pos += length;
      } else if (running && (beats < 0.0 || beats >= length)) {
        running = false;             // played once already, or the transport is still before the start
        pos = beats < 0.0 ? 0.0 : length;
      }
      phase_[i] = phaseOf(pos, length, running);

      if (!running || !(alwaysOn || gateHigh(lanes::lane(play[i], 0)))) {
        release(i, kNothingCovered);
        haveLast_ = false;           // a restart is a fresh evaluation, not a jump backwards from here
        continue;
      }
      // The playhead moved backwards: the clip looped, or the transport jumped. Releasing everything first
      // is what retriggers a note that fills the whole clip, which the set difference alone would hold
      // across the wrap and never release.
      if (haveLast_ && pos < lastPos_) release(i, kNothingCovered);
      release(i, pos);
      start(i, pos, transpose);
      lastPos_ = pos;
      haveLast_ = true;
    }
  }

  /// `pos` when the clip is running, and the far end of it when a non-looping clip has run out.
  static float phaseOf(double pos, double length, bool running) {
    if (length <= 0.0) return 0.f;
    const float phase = static_cast<float>(std::clamp(pos / length, 0.0, 1.0));
    return running && phase >= 1.f ? kJustBelowOne : phase;
  }

  /// Note off for every held note the playhead is no longer inside. `kNothingCovered` is before every note
  /// (starts are validated non-negative), so it releases the lot.
  static constexpr double kNothingCovered = -1.0;
  void release(uint32_t frame, double pos) {
    uint32_t keep = 0;
    for (uint32_t k = 0; k < heldCount_; ++k) {
      const Held h = held_[k];
      const ClipNote& n = notes_[h.index];
      const bool covered = pos >= n.start && pos < n.end;
      Event e;
      e.frame = frame;
      e.type = EventType::NoteOff;
      e.noteId = h.id;
      e.a = h.note;
      if (!covered && record(e)) { sounding_[h.index] = 0; continue; }
      held_[keep++] = h;   // still sounding, or the block is out of events and it is released next block
    }
    heldCount_ = keep;
  }

  /// Note on for every note the playhead has just entered.
  void start(uint32_t frame, double pos, float transpose) {
    for (uint32_t i = 0; i < notes_.size(); ++i) {
      const ClipNote& n = notes_[i];
      if (n.start > pos) break;   // sorted by start: no later note can have begun
      if (sounding_[i] != 0 || pos >= n.end) continue;
      Event e;
      e.frame = frame;
      e.type = EventType::NoteOn;
      e.noteId = nextId_++;
      e.a = std::clamp(n.pitch + transpose, 0.f, 127.f);
      e.b = n.velocity;
      if (!record(e)) return;
      sounding_[i] = 1;
      held_[heldCount_++] = Held{i, e.a, e.noteId};
    }
  }

  /// Appends to the block's event list, or reports that it is full. A refused event leaves the sounding set
  /// exactly describing what HAS been emitted, so the next block emits the rest -- rather than a note on
  /// landing with its note off dropped on the floor.
  bool record(const Event& e) {
    if (eventCount_ == events_.size()) return false;
    events_[eventCount_++] = e;
    return true;
  }

  std::vector<ClipNote> notes_;      // sorted by start; message thread builds it, audio thread only reads
  std::vector<uint8_t> sounding_;    // per note: is it currently held?
  std::vector<Held> held_;           // the held notes, compacted; heldCount_ of them are live
  std::vector<Event> events_;        // this block's events, recorded on pair 0 and replayed for every pair
  std::array<float, kMaxBlockSize> phase_{};
  uint32_t heldCount_ = 0;
  uint32_t eventCount_ = 0;
  uint32_t nextId_ = 1;
  double lastPos_ = 0.0;
  bool haveLast_ = false;
};

}  // namespace

// Explicit `extern` (see AudioOut.cpp): a namespace-scope `const` is internal linkage by default.
extern const ModuleDescriptor kNotesClip{kModuleAbiVersion, "notes.clip", "Clip", "note",
  "Plays a list of notes against the transport and emits them as a note stream. The notes live in the "
  "node's data as \"notes\": an array of {start, length, pitch, velocity} objects, start and length in "
  "beats from the clip's start, pitch a MIDI note number and velocity 0..1. Anything else in that array is "
  "rejected as a whole and the clip plays nothing. The playhead is derived from the transport, so it "
  "follows the host when it plays, free-runs at the transport tempo when it does not, and survives an edit "
  "to the notes.",
  kIn, countOf(kIn), kOut, countOf(kOut), kParams, countOf(kParams), kModuleNeedsTransport, 0,
  [] () -> Module* { return new NotesClip(); }};

}  // namespace pg::modules

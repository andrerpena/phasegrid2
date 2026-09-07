#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <array>
#include <map>
#include <memory>
#include <nlohmann/json.hpp>
#include <string>
#include <vector>
#include "core/Module.hpp"
#include "modules/TestModules.hpp"
#include "modules/builtin.hpp"
#include "util/GraphFixture.hpp"
#include "util/RtGuard.hpp"

namespace {

constexpr double kSampleRate = 48000.0;
/// 45000 BPM is 750 beats a second, so one beat is exactly 64 samples at 48 kHz and one 64-frame block is
/// exactly one beat. Every position below is then exact in double, which is what lets these tests assert
/// the frame an event lands on rather than a window around it.
constexpr double kTempo = 45000.0;
constexpr uint32_t kMaxPairs = 16;

/// Copies the clip's event stream out of the shared buffer once for EVERY voice pair, so a test can both
/// read the events and check that the pairs all saw the same ones. Fixed storage: the same rig drives the
/// allocation test.
struct EventLog {
  std::array<pg::Event, 128> events{};
  uint32_t count = 0;
};
struct Recorder : pg::VoicedModule<int> {
  static inline std::array<EventLog, kMaxPairs> perPair{};
  void process(pg::ProcessContext& c) override {
    EventLog& log = perPair[c.voice];
    for (const pg::Event& e : c.eventIn(0))
      if (log.count < log.events.size()) log.events[log.count++] = e;
  }
};
const pg::PortDesc kRecIn[] = {{"notes", "Notes", pg::PortKind::Event, 0, pg::SignalRole::Note, ""}};
const pg::ModuleDescriptor kRecorder{pg::kModuleAbiVersion, "test.noteRecorder", "NoteRecorder", "test", "",
  kRecIn, 1, nullptr, 0, nullptr, 0, 0, 0, [] () -> pg::Module* { return new Recorder(); }};

/// A gate that starts high and flips at each absolute sample position in `toggles`, so a test can stop and
/// restart the clip at an exact frame in the middle of a block.
struct PlayGate : pg::VoicedModule<int> {
  static inline std::vector<uint64_t> toggles;
  static inline uint64_t base = 0;   // absolute position of this block's first frame
  void process(pg::ProcessContext& c) override {
    for (uint32_t i = 0; i < c.numFrames; ++i) {
      size_t flips = 0;
      for (const uint64_t t : toggles)
        if (base + i >= t) ++flips;
      c.out(0).data[i] = pg::Sample(flips % 2 == 0 ? 1.f : 0.f);
    }
  }
};
const pg::PortDesc kGateOut[] = {{"out", "Out", pg::PortKind::Continuous, 1, pg::SignalRole::Gate, ""}};
const pg::ModuleDescriptor kPlayGate{pg::kModuleAbiVersion, "test.playGate", "PlayGate", "test", "",
  nullptr, 0, kGateOut, 1, nullptr, 0, 0, 0, [] () -> pg::Module* { return new PlayGate(); }};

/// One recorded event, tagged with the absolute frame of the whole run rather than the frame within a block.
struct Timed {
  uint64_t frame = 0;
  pg::Event e;
  bool on() const { return e.type == pg::EventType::NoteOn; }
};

nlohmann::json note(double start, double length, double pitch, double velocity = 1.0) {
  return nlohmann::json{{"start", start}, {"length", length}, {"pitch", pitch}, {"velocity", velocity}};
}
nlohmann::json clipData(std::initializer_list<nlohmann::json> notes) {
  return nlohmann::json{{"notes", nlohmann::json(notes)}};
}

/// play -> notes.clip -> recorder, with the clip's notes installed as node data.
struct Rig {
  pg::test::GraphFixture f;
  std::unique_ptr<pg::Program> program;
  std::vector<Timed> log;
  uint64_t pos = 0;
  bool logging = true;

  Rig(const nlohmann::json& data, std::map<std::string, float> params = {}, uint32_t voices = 1, bool wirePlay = true) {
    pg::registerBuiltinModules(f.reg);
    REQUIRE_FALSE(f.reg.add(kRecorder).has_value());
    REQUIRE_FALSE(f.reg.add(kPlayGate).has_value());
    PlayGate::toggles.clear();
    PlayGate::base = 0;
    Recorder::perPair = {};
    REQUIRE(f.model.setVoiceCount(voices));
    f.node("clip", "notes.clip", std::move(params));
    REQUIRE(f.model.setNodeData("clip", data));
    f.node("rec", "test.noteRecorder");
    f.edge("e0", "clip.notes", "rec.notes");
    if (wirePlay) {
      f.node("play", "test.playGate");
      f.edge("e1", "play.out", "clip.play");
    }
    f.transport.tempo = kTempo;
    program = f.compile(kSampleRate, 64);
  }

  /// One block starting at an explicit sample position, which is how a transport jump is spelled.
  void runAt(uint64_t samplePos, uint32_t frames = 64) {
    Recorder::perPair = {};
    PlayGate::base = samplePos;
    f.transport.samplePos = samplePos;
    f.run(*program, frames);
    if (logging)
      for (uint32_t i = 0; i < Recorder::perPair[0].count; ++i) {
        const pg::Event& e = Recorder::perPair[0].events[i];
        log.push_back(Timed{samplePos + e.frame, e});
      }
    pos = samplePos + frames;
  }
  void run(uint32_t frames = 64) { runAt(pos, frames); }
  void runBlocks(uint32_t n) {
    for (uint32_t i = 0; i < n; ++i) run();
  }
  float phase(uint32_t frame) { return f.out(*program, "clip", "phase", frame); }
};

/// Fails unless every note on in the log is matched by a later note off, and no note is ever on twice at
/// once. This is the invariant the whole module exists to keep, so several tests end with it.
void requireBalanced(const std::vector<Timed>& log) {
  std::map<float, int> outstanding;
  for (const Timed& t : log) {
    int& n = outstanding[t.e.a];
    n += t.on() ? 1 : -1;
    INFO("note " << t.e.a << " at frame " << t.frame << " went to " << n);
    REQUIRE(n >= 0);
    REQUIRE(n <= 1);
  }
  for (const auto& [pitch, n] : outstanding) {
    INFO("note " << pitch << " left sounding");
    REQUIRE(n == 0);
  }
}

}  // namespace

TEST_CASE("notes.clip emits a note on and a note off at the exact frame, every time round the loop", "[modules][clip]") {
  Rig rig(clipData({note(1.0, 2.0, 60.0, 0.5)}), {{"length", 4.f}, {"loop", 1.f}});
  rig.runBlocks(8);   // 512 samples = 8 beats = two turns of a four-beat clip

  REQUIRE(rig.log.size() == 4);
  REQUIRE(rig.log[0].on());
  REQUIRE(rig.log[0].frame == 64);       // beat 1
  REQUIRE(rig.log[0].e.a == 60.f);
  REQUIRE(rig.log[0].e.b == Catch::Approx(0.5f));
  REQUIRE_FALSE(rig.log[1].on());
  REQUIRE(rig.log[1].frame == 192);      // beat 3
  REQUIRE(rig.log[1].e.a == 60.f);
  REQUIRE(rig.log[2].on());
  REQUIRE(rig.log[2].frame == 320);      // beat 5, one clip length on
  REQUIRE_FALSE(rig.log[3].on());
  REQUIRE(rig.log[3].frame == 448);
  REQUIRE(rig.log[0].e.noteId != rig.log[2].e.noteId);   // the second pass is a new note, not the same one
  REQUIRE(rig.log[1].e.noteId == rig.log[0].e.noteId);   // and each off carries the id of its own on
  requireBalanced(rig.log);
}

TEST_CASE("notes.clip places events inside a block, not at its edges", "[modules][clip]") {
  // A quarter of a beat is sixteen samples, so both events land inside the first block. A clip that only
  // looked at block boundaries would put them both at frame 0.
  Rig rig(clipData({note(0.25, 0.5, 72.0)}), {{"length", 4.f}});
  rig.run();

  REQUIRE(rig.log.size() == 2);
  REQUIRE(rig.log[0].frame == 16);
  REQUIRE(rig.log[1].frame == 48);
  requireBalanced(rig.log);
}

TEST_CASE("notes.clip emits a chord as simultaneous note ons in the order it was written", "[modules][clip]") {
  Rig rig(clipData({note(0.0, 1.0, 60.0, 0.25), note(0.0, 1.0, 67.0, 0.5), note(0.0, 1.0, 64.0, 1.0)}),
          {{"length", 4.f}});
  rig.run();

  REQUIRE(rig.log.size() == 3);
  for (const Timed& t : rig.log) {
    REQUIRE(t.on());
    REQUIRE(t.frame == 0);
  }
  REQUIRE(rig.log[0].e.a == 60.f);   // sorted by start only, and stably: equal starts keep their order
  REQUIRE(rig.log[1].e.a == 67.f);
  REQUIRE(rig.log[2].e.a == 64.f);
  REQUIRE(rig.log[1].e.b == Catch::Approx(0.5f));
}

TEST_CASE("notes.clip releases a note the loop point cuts short", "[modules][clip]") {
  // The note runs from beat 3 to beat 5 but the clip is four beats long, so the playhead leaves it at the
  // wrap. Without a release there it would be a note on with no note off, for ever.
  Rig rig(clipData({note(3.0, 2.0, 60.0)}), {{"length", 4.f}, {"loop", 1.f}});
  rig.runBlocks(9);

  REQUIRE(rig.log.size() == 4);
  REQUIRE(rig.log[0].on());
  REQUIRE(rig.log[0].frame == 192);
  REQUIRE_FALSE(rig.log[1].on());
  REQUIRE(rig.log[1].frame == 256);   // the wrap, not beat 5
  REQUIRE(rig.log[2].on());
  REQUIRE(rig.log[2].frame == 448);
  REQUIRE_FALSE(rig.log[3].on());
  REQUIRE(rig.log[3].frame == 512);
  requireBalanced(rig.log);
}

TEST_CASE("notes.clip retriggers a note that fills the whole clip", "[modules][clip]") {
  // The playhead never leaves this note, so a plain "is it still covered?" test would hold it down for ever
  // and never emit a note off. The wrap releases first and starts again.
  Rig rig(clipData({note(0.0, 4.0, 60.0)}), {{"length", 4.f}, {"loop", 1.f}});
  rig.runBlocks(9);

  REQUIRE(rig.log.size() == 5);
  REQUIRE(rig.log[0].on());
  REQUIRE(rig.log[0].frame == 0);
  REQUIRE_FALSE(rig.log[1].on());
  REQUIRE(rig.log[1].frame == 256);
  REQUIRE(rig.log[2].on());
  REQUIRE(rig.log[2].frame == 256);   // the off comes first at the same frame, so nothing overlaps
  REQUIRE_FALSE(rig.log[3].on());
  REQUIRE(rig.log[3].frame == 512);
  REQUIRE(rig.log[4].on());
  REQUIRE(rig.log[4].frame == 512);
  requireBalanced({rig.log.begin(), rig.log.end() - 1});   // all but the final, still-sounding note on
}

TEST_CASE("notes.clip releases what it holds when play falls, and picks up again when it rises", "[modules][clip]") {
  Rig rig(clipData({note(0.0, 4.0, 60.0)}), {{"length", 4.f}, {"loop", 1.f}});
  PlayGate::toggles = {74, 100};   // low from frame 74, high again from 100: both inside block 1
  rig.runBlocks(3);

  REQUIRE(rig.log.size() == 3);
  REQUIRE(rig.log[0].on());
  REQUIRE(rig.log[0].frame == 0);
  REQUIRE_FALSE(rig.log[1].on());
  REQUIRE(rig.log[1].frame == 74);    // mid note, mid block
  REQUIRE(rig.log[2].on());
  REQUIRE(rig.log[2].frame == 100);   // the playhead is inside the note again, so it sounds again
  requireBalanced({rig.log.begin(), rig.log.end() - 1});
}

TEST_CASE("notes.clip follows a transport jump in both directions", "[modules][clip]") {
  Rig rig(clipData({note(0.0, 1.0, 60.0), note(2.0, 2.0, 67.0)}), {{"length", 4.f}, {"loop", 1.f}});
  rig.runAt(0);
  REQUIRE(rig.log.size() == 1);
  REQUIRE(rig.log[0].on());
  REQUIRE(rig.log[0].e.a == 60.f);

  rig.runAt(160);   // jump forward to beat 2.5, inside the second note and past the end of the first
  REQUIRE(rig.log.size() == 3);
  REQUIRE_FALSE(rig.log[1].on());
  REQUIRE(rig.log[1].e.a == 60.f);
  REQUIRE(rig.log[1].frame == 160);
  REQUIRE(rig.log[2].on());
  REQUIRE(rig.log[2].e.a == 67.f);
  REQUIRE(rig.log[2].frame == 160);   // released and started on the same frame, release first

  rig.runAt(0);     // jump back to the start
  REQUIRE(rig.log.size() == 5);
  REQUIRE_FALSE(rig.log[3].on());
  REQUIRE(rig.log[3].e.a == 67.f);
  REQUIRE(rig.log[4].on());
  REQUIRE(rig.log[4].e.a == 60.f);
  requireBalanced({rig.log.begin(), rig.log.end() - 1});
}

TEST_CASE("notes.clip follows the transport's musical position when it is playing", "[modules][clip]") {
  Rig rig(clipData({note(0.0, 1.0, 60.0), note(2.0, 1.0, 67.0)}), {{"length", 4.f}, {"loop", 1.f}});
  rig.f.transport.playing = true;
  rig.f.transport.ppq = 0.0;
  rig.runAt(160);   // a sample position that free-running would put at beat 2.5, inside the OTHER note

  REQUIRE(rig.log.size() == 1);
  REQUIRE(rig.log[0].on());
  REQUIRE(rig.log[0].e.a == 60.f);   // ppq wins: the sample position is ignored while the transport plays

  rig.f.transport.ppq = 2.0;
  rig.runAt(160);
  REQUIRE(rig.log.size() == 3);
  REQUIRE_FALSE(rig.log[1].on());
  REQUIRE(rig.log[1].e.a == 60.f);
  REQUIRE(rig.log[2].on());
  REQUIRE(rig.log[2].e.a == 67.f);
}

TEST_CASE("notes.clip with loop off plays once and then stops", "[modules][clip]") {
  Rig rig(clipData({note(0.0, 1.0, 60.0)}), {{"length", 4.f}, {"loop", 0.f}});
  rig.runBlocks(16);   // four clip lengths' worth of transport

  REQUIRE(rig.log.size() == 2);
  REQUIRE(rig.log[0].frame == 0);
  REQUIRE(rig.log[1].frame == 64);
  REQUIRE(rig.phase(63) == 1.f);   // parked at the end rather than wrapped round
  requireBalanced(rig.log);
}

TEST_CASE("notes.clip's length param sets how far the playhead runs before it wraps", "[modules][clip]") {
  // Two beats, so the note comes round twice as often as the four-beat clip every other test uses.
  Rig rig(clipData({note(0.0, 0.5, 60.0)}), {{"length", 2.f}, {"loop", 1.f}});
  rig.runBlocks(8);

  REQUIRE(rig.log.size() == 8);            // four passes over eight beats, not two
  REQUIRE(rig.log[0].frame == 0);
  REQUIRE(rig.log[1].frame == 32);
  REQUIRE(rig.log[2].frame == 128);        // one clip length on, at beat 2 rather than beat 4
  REQUIRE(rig.log[6].frame == 384);
  REQUIRE(rig.phase(32) == Catch::Approx(0.75f));   // and the phase spans the clip, whatever its length
  requireBalanced(rig.log);
}

TEST_CASE("notes.clip's phase output tracks the playhead", "[modules][clip]") {
  Rig rig(nlohmann::json::object(), {{"length", 4.f}, {"loop", 1.f}});
  rig.runAt(0);
  REQUIRE(rig.phase(0) == 0.f);
  REQUIRE(rig.phase(32) == Catch::Approx(0.125f));   // half a beat into a four-beat clip

  rig.runAt(128);
  REQUIRE(rig.phase(0) == Catch::Approx(0.5f));

  rig.runAt(192);
  REQUIRE(rig.phase(63) < 1.f);                      // the last frame before the wrap is still inside
  REQUIRE(rig.phase(63) == Catch::Approx(0.99609375f));
  rig.runAt(256);
  REQUIRE(rig.phase(0) == 0.f);                      // and the wrap puts it back at the start
}

TEST_CASE("notes.clip's phase never reaches one while the clip is running", "[modules][clip]") {
  // A double a hair under one narrows UP to exactly 1.0f, which the phase output has to catch rather than
  // trust -- the trap phase.clock documents. One beat a minute makes a sixteen-beat clip 46,080,000 samples
  // long, far enough that the ratio at the last sample before the wrap rounds to exactly 1.0f.
  Rig rig(nlohmann::json::object(), {{"length", 16.f}, {"loop", 1.f}});
  rig.f.transport.tempo = 1.0;
  rig.runAt(46079999, 1);
  REQUIRE(rig.phase(0) == Catch::Approx(1.f).epsilon(1e-6));   // it really is at the very end of the clip
  REQUIRE(rig.phase(0) < 1.f);                                 // and still inside it
}

TEST_CASE("notes.clip transposes each note as it starts", "[modules][clip]") {
  Rig rig(clipData({note(0.0, 1.0, 60.0)}), {{"length", 4.f}, {"transpose", 12.f}});
  rig.runBlocks(2);   // the note ends on the first frame of the second block
  REQUIRE(rig.log.size() == 2);
  REQUIRE(rig.log[0].e.a == 72.f);
  REQUIRE(rig.log[1].e.a == 72.f);   // and the off matches the on, not the untransposed note
  requireBalanced(rig.log);
}

TEST_CASE("malformed clip data plays nothing rather than throwing", "[modules][clip]") {
  auto plays = [](const nlohmann::json& data) {
    Rig rig(data, {{"length", 4.f}});
    rig.runBlocks(4);
    return rig.log.size();
  };
  REQUIRE(plays(clipData({note(0.0, 1.0, 60.0)})) == 2);   // the control: well-formed data does play

  REQUIRE(plays(nlohmann::json{{"notes", 7}}) == 0);                       // not an array
  REQUIRE(plays(nlohmann::json{{"notes", {"a", "b"}}}) == 0);              // not objects
  REQUIRE(plays(nlohmann::json{{"notes", {{{"start", 0}, {"length", 1}, {"pitch", 60}}}}}) == 0);   // no velocity
  REQUIRE(plays(nlohmann::json{{"notes", {{{"start", "0"}, {"length", 1}, {"pitch", 60}, {"velocity", 1}}}}}) == 0);
  REQUIRE(plays(clipData({note(-1.0, 1.0, 60.0)})) == 0);                  // negative start
  REQUIRE(plays(clipData({note(0.0, 0.0, 60.0)})) == 0);                   // zero length
  REQUIRE(plays(clipData({note(0.0, 1.0, 200.0)})) == 0);                  // not a MIDI note
  REQUIRE(plays(clipData({note(0.0, 1.0, 60.0, 2.0)})) == 0);              // velocity out of range
  REQUIRE(plays(clipData({note(0.0, 1.0, 60.0), note(0.0, 0.0, 64.0)})) == 0);   // one bad note voids the clip
  REQUIRE(plays(nlohmann::json::object()) == 0);                           // no notes at all is simply empty
}

TEST_CASE("notes.clip gives every voice pair the same note stream", "[modules][clip]") {
  // The event buffer is cleared and refilled once per pair, so a clip that worked its events out inside the
  // per-pair loop would hand pair 1 a different (or empty) stream than pair 0.
  Rig rig(clipData({note(0.0, 1.0, 60.0), note(0.0, 1.0, 64.0)}), {{"length", 4.f}}, 4);
  rig.run();

  REQUIRE(Recorder::perPair[0].count == 2);   // it really emitted something, so the comparison means something
  REQUIRE(Recorder::perPair[1].count == Recorder::perPair[0].count);
  for (uint32_t i = 0; i < Recorder::perPair[0].count; ++i) {
    const pg::Event& a = Recorder::perPair[0].events[i];
    const pg::Event& b = Recorder::perPair[1].events[i];
    REQUIRE(b.frame == a.frame);
    REQUIRE(b.type == a.type);
    REQUIRE(b.a == a.a);
    REQUIRE(b.b == a.b);
    REQUIRE(b.noteId == a.noteId);
  }
}

TEST_CASE("notes.clip runs with nothing plugged into play", "[modules][clip]") {
  Rig rig(clipData({note(0.0, 1.0, 60.0)}), {{"length", 4.f}}, 1, false);
  rig.runBlocks(2);
  REQUIRE(rig.log.size() == 2);   // an unconnected gate would read as silence and stop the clip for ever
}

TEST_CASE("notes.clip never leaves a note on without its note off", "[modules][clip]") {
  // Everything that can move the playhead, in one run: overlapping notes, loop wraps, jumps forwards and
  // backwards, and the play gate falling and rising mid block.
  Rig rig(clipData({note(0.0, 4.0, 60.0), note(0.5, 1.0, 64.0), note(2.0, 2.5, 67.0), note(3.9, 0.2, 72.0)}),
          {{"length", 4.f}, {"loop", 1.f}});
  PlayGate::toggles = {300, 380, 700, 760};
  rig.runBlocks(6);
  rig.runAt(1000);
  rig.runAt(40);
  rig.runAt(1000);
  rig.runAt(3);
  rig.runBlocks(6);

  REQUIRE(rig.log.size() > 20);   // it really did play, so the balance below is not a property of nothing
  PlayGate::toggles = {0};        // hold play low for a whole block: everything must come back off
  rig.run();
  requireBalanced(rig.log);
}

TEST_CASE("notes.clip is allocation free", "[modules][clip][rt]") {
  Rig rig(clipData({note(0.0, 1.0, 60.0), note(0.5, 2.0, 64.0), note(2.0, 2.5, 67.0)}),
          {{"length", 4.f}, {"loop", 1.f}});
  PlayGate::toggles = {300, 380};
  rig.runBlocks(4);
  REQUIRE(rig.log.size() == 5);   // it really is emitting events, so the check below is not measuring silence

  rig.logging = false;            // the log is the only allocating part of the rig
  pg::test::resetRtViolations();
  {
    pg::test::RtScope scope;
    for (int i = 0; i < 200; ++i) rig.run();
  }
  REQUIRE(pg::test::rtViolations() == 0);
}

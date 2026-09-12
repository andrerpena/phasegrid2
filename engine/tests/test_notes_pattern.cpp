/*
 * `notes.pattern`: a mini-notation string played against the transport.
 *
 * The notation itself is covered exhaustively against real Strudel in `test_mini.cpp`. What is
 * tested here is the module around it -- which frame a note lands on, that every note on gets its
 * note off, how velocity aligns, and that editing the string does not make the playhead jump.
 */
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
/// 45000 BPM is 750 beats a second, so one beat is exactly 64 samples at 48 kHz and one 64-frame
/// block is exactly one beat. Every position below is then exact in double, which is what lets
/// these tests assert the frame an event lands on rather than a window around it.
constexpr double kTempo = 45000.0;
/// The `cycle` param's index for "1/4" -- one cycle per beat, so one cycle is one block.
constexpr float kCycleQuarter = 2.f;
constexpr uint32_t kMaxPairs = 16;

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
  kRecIn, 1, nullptr, 0, nullptr, 0, 0, 0, [] () -> pg::Module* { return new Recorder(); }, nullptr, 0};

/// A gate that starts high and flips at each absolute sample position in `toggles`, so a test can
/// stop the pattern at an exact frame in the middle of a block.
struct PlayGate : pg::VoicedModule<int> {
  static inline std::vector<uint64_t> toggles;
  static inline uint64_t base = 0;
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
  nullptr, 0, kGateOut, 1, nullptr, 0, 0, 0, [] () -> pg::Module* { return new PlayGate(); }, nullptr, 0};

struct Timed {
  uint64_t frame = 0;
  pg::Event e;
  bool on() const { return e.type == pg::EventType::NoteOn; }
};

nlohmann::json patternData(const std::string& pattern, const std::string& velocity = "") {
  nlohmann::json data{{"pattern", pattern}};
  if (!velocity.empty()) data["velocity"] = velocity;
  return data;
}

/// notes.pattern -> recorder, with the pattern installed as node data.
struct Rig {
  pg::test::GraphFixture f;
  std::unique_ptr<pg::Program> program;
  std::vector<Timed> log;
  uint64_t pos = 0;

  explicit Rig(const nlohmann::json& data, std::map<std::string, float> params = {},
               bool wirePlay = false) {
    pg::registerBuiltinModules(f.reg);
    REQUIRE_FALSE(f.reg.add(kRecorder).has_value());
    REQUIRE_FALSE(f.reg.add(kPlayGate).has_value());
    PlayGate::toggles.clear();
    PlayGate::base = 0;
    Recorder::perPair = {};
    log.reserve(1024);   // the RT test runs blocks inside an allocation guard
    if (!params.contains("cycle")) params["cycle"] = kCycleQuarter;
    // Legato 1 would end each note exactly where the next begins; a shorter hold keeps the note
    // off and the next note on on different frames, which is what most of these assertions read.
    if (!params.contains("legato")) params["legato"] = 0.5f;
    f.node("pat", "notes.pattern", std::move(params));
    REQUIRE(f.model.setNodeData("pat", data));
    f.node("rec", "test.noteRecorder");
    f.edge("e0", "pat.notes", "rec.notes");
    if (wirePlay) {
      f.node("play", "test.playGate");
      f.edge("e1", "play.out", "pat.play");
    }
    f.transport.tempo = kTempo;
    program = f.compile(kSampleRate, 64);
  }

  void runAt(uint64_t samplePos, uint32_t frames = 64) {
    Recorder::perPair = {};
    PlayGate::base = samplePos;
    f.transport.samplePos = samplePos;
    f.run(*program, frames);
    for (uint32_t i = 0; i < Recorder::perPair[0].count; ++i) {
      const pg::Event& e = Recorder::perPair[0].events[i];
      log.push_back(Timed{samplePos + e.frame, e});
    }
    pos = samplePos + frames;
  }
  void run(uint32_t frames = 64) { runAt(pos, frames); }
  void runBlocks(uint32_t n) { for (uint32_t i = 0; i < n; ++i) run(); }
  float phase(uint32_t frame) { return f.out(*program, "pat", "phase", frame); }

  /// Installs a new pattern the way an edit does: node data is structural, so the compile builds a
  /// new instance, and the swap hands it the old one to adopt from, as `Engine::swapIfPending` does.
  void edit(const nlohmann::json& data) {
    REQUIRE(f.model.setNodeData("pat", data));
    auto next = f.compile(kSampleRate, 64);
    next->adoptFrom(*program);
    program = std::move(next);
  }

  std::vector<Timed> onsets() const {
    std::vector<Timed> out;
    for (const Timed& t : log) if (t.on()) out.push_back(t);
    return out;
  }
};

/// Fails unless no note is ever on twice at once and no note off arrives for a note that is not
/// sounding. This is the invariant the module exists to keep, so most tests end with it.
///
/// A note still held when the run stops is not a failure -- the playhead simply stopped inside it.
/// `requireQuiet` is for the tests where everything should have been released.
void requireBalanced(const std::vector<Timed>& log) {
  std::map<float, int> outstanding;
  for (const Timed& t : log) {
    int& n = outstanding[t.e.a];
    n += t.on() ? 1 : -1;
    INFO("note " << t.e.a << " at frame " << t.frame << " went to " << n);
    REQUIRE(n >= 0);
    REQUIRE(n <= 1);
  }
}

void requireQuiet(const std::vector<Timed>& log) {
  requireBalanced(log);
  std::map<float, int> outstanding;
  for (const Timed& t : log) outstanding[t.e.a] += t.on() ? 1 : -1;
  for (const auto& [pitch, n] : outstanding) {
    INFO("note " << pitch << " left sounding");
    REQUIRE(n == 0);
  }
}

}  // namespace

TEST_CASE("four steps land on the quarters of a cycle", "[pattern]") {
  // One cycle is one block of 64 frames, so four steps are 16 frames apart, exactly.
  Rig rig(patternData("c4 e4 g4 b4"));
  rig.run();
  const auto onsets = rig.onsets();
  REQUIRE(onsets.size() == 4);
  CHECK(onsets[0].frame == 0);
  CHECK(onsets[1].frame == 16);
  CHECK(onsets[2].frame == 32);
  CHECK(onsets[3].frame == 48);
  CHECK(onsets[0].e.a == 60.f);   // a bare octave number is Strudel's: c4 is middle C
  CHECK(onsets[1].e.a == 64.f);
  CHECK(onsets[2].e.a == 67.f);
  CHECK(onsets[3].e.a == 71.f);
  rig.runBlocks(3);
  requireBalanced(rig.log);
}

TEST_CASE("a rest is a step nothing sounds in", "[pattern]") {
  Rig rig(patternData("c4 ~ g4 ~"));
  rig.run();
  const auto onsets = rig.onsets();
  REQUIRE(onsets.size() == 2);
  CHECK(onsets[0].frame == 0);
  CHECK(onsets[1].frame == 32);
}

TEST_CASE("alternation takes one step per cycle", "[pattern]") {
  Rig rig(patternData("<c4 e4 g4>"));
  rig.runBlocks(4);
  const auto onsets = rig.onsets();
  REQUIRE(onsets.size() == 4);
  CHECK(onsets[0].e.a == 60.f);
  CHECK(onsets[1].e.a == 64.f);
  CHECK(onsets[2].e.a == 67.f);
  CHECK(onsets[3].e.a == 60.f);   // and round again
  CHECK(onsets[3].frame == 192);
}

TEST_CASE("a stack is a chord", "[pattern]") {
  Rig rig(patternData("[c4,e4,g4]"));
  rig.run();
  const auto onsets = rig.onsets();
  REQUIRE(onsets.size() == 3);
  for (const Timed& t : onsets) CHECK(t.frame == 0);
  CHECK(onsets[0].e.a == 60.f);
  CHECK(onsets[1].e.a == 64.f);
  CHECK(onsets[2].e.a == 67.f);
  // Three notes at once means three ids: a chord that shared one could not be released note by note.
  CHECK(onsets[0].e.noteId != onsets[1].e.noteId);
  CHECK(onsets[1].e.noteId != onsets[2].e.noteId);
  rig.runBlocks(2);
  requireBalanced(rig.log);
}

TEST_CASE("velocity is taken where the note starts, not step by step", "[pattern]") {
  // Three notes against two velocities: each note takes whichever value is running when it
  // begins, which is Strudel's `appLeft`. The middle note straddles the change and takes the
  // value at its own onset -- the first one -- rather than being split in two.
  Rig rig(patternData("c4 e4 g4", "1 0.25"));
  rig.run();
  const auto onsets = rig.onsets();
  REQUIRE(onsets.size() == 3);
  CHECK(onsets[0].e.b == Catch::Approx(1.0));
  CHECK(onsets[1].e.b == Catch::Approx(1.0));
  CHECK(onsets[2].e.b == Catch::Approx(0.25));
}

TEST_CASE("the gain knob scales every velocity", "[pattern]") {
  Rig rig(patternData("c4 e4", "1 0.5"), {{"gain", 0.5f}});
  rig.run();
  const auto onsets = rig.onsets();
  REQUIRE(onsets.size() == 2);
  CHECK(onsets[0].e.b == Catch::Approx(0.5));
  CHECK(onsets[1].e.b == Catch::Approx(0.25));
}

TEST_CASE("with no velocity pattern the gain knob is the velocity", "[pattern]") {
  Rig rig(patternData("c4"), {{"gain", 0.75f}});
  rig.run();
  REQUIRE(rig.onsets().size() == 1);
  CHECK(rig.onsets()[0].e.b == Catch::Approx(0.75));
}

TEST_CASE("legato decides how long a note holds", "[pattern]") {
  // Two steps of 32 frames each, held for a quarter of their width: 8 frames.
  Rig rig(patternData("c4 e4"), {{"legato", 0.25f}});
  rig.run();
  REQUIRE(rig.log.size() == 4);
  CHECK(rig.log[0].frame == 0);
  CHECK(rig.log[0].on());
  CHECK(rig.log[1].frame == 8);
  CHECK_FALSE(rig.log[1].on());
  CHECK(rig.log[2].frame == 32);
  CHECK(rig.log[3].frame == 40);
}

TEST_CASE("transpose moves the notes and still releases the right one", "[pattern]") {
  Rig rig(patternData("c4 e4"), {{"transpose", 12.f}});
  rig.run();
  const auto onsets = rig.onsets();
  REQUIRE(onsets.size() == 2);
  CHECK(onsets[0].e.a == 72.f);
  CHECK(onsets[1].e.a == 76.f);
  rig.runBlocks(2);
  requireBalanced(rig.log);
}

TEST_CASE("phase runs from zero to just under one across a cycle", "[pattern]") {
  Rig rig(patternData("c4"));
  rig.run();
  CHECK(rig.phase(0) == Catch::Approx(0.0));
  CHECK(rig.phase(32) == Catch::Approx(0.5));
  CHECK(rig.phase(63) < 1.f);
  CHECK(rig.phase(63) == Catch::Approx(63.0 / 64.0));
}

TEST_CASE("the play gate stops the pattern and releases what it holds", "[pattern]") {
  Rig rig(patternData("c4 e4 g4 b4"), {{"legato", 1.f}}, true);
  PlayGate::toggles = {40};   // the gate falls in the middle of the third step
  rig.run();
  REQUIRE(rig.log.size() >= 2);
  // Whatever was sounding is released on the very frame the gate falls, and nothing starts after.
  const Timed& last = rig.log.back();
  CHECK_FALSE(last.on());
  CHECK(last.frame == 40);
  requireQuiet(rig.log);
  rig.run();
  CHECK(rig.log.back().frame == 40);   // still stopped: the second block adds nothing
}

TEST_CASE("a pattern that will not parse plays nothing", "[pattern]") {
  Rig rig(patternData("c4 [e4"));
  rig.runBlocks(4);
  CHECK(rig.log.empty());
}

TEST_CASE("an empty pattern plays nothing", "[pattern]") {
  Rig rig(patternData(" "));
  rig.runBlocks(4);
  CHECK(rig.log.empty());
}

TEST_CASE("a jump backwards releases what was sounding", "[pattern]") {
  Rig rig(patternData("c4 e4 g4 b4"), {{"legato", 1.f}});
  rig.runAt(0);
  rig.runAt(0);           // the transport jumped back to the start
  requireBalanced(rig.log);
  // The note that was sounding across the seam was released before the pattern began again.
  CHECK_FALSE(rig.log[rig.log.size() - 2].on());
}

TEST_CASE("editing the pattern resumes where the old one was", "[pattern]") {
  // Node data is structural, so an edit builds a NEW instance. The playhead is derived from the
  // transport rather than accumulated, which is the whole reason that is affordable: the rebuilt
  // instance has to land where the old one was rather than restarting the cycle.
  Rig rig(patternData("c4 e4 g4 b4"));
  rig.runBlocks(2);
  rig.edit(patternData("d4 f4 a4 c5"));
  rig.log.clear();
  rig.run();
  const auto onsets = rig.onsets();
  REQUIRE(onsets.size() == 4);
  CHECK(onsets[0].frame == 128);   // the third cycle, not the first
  CHECK(onsets[0].e.a == 62.f);
  CHECK(onsets[3].frame == 176);
}

TEST_CASE("editing the pattern releases the note the old instance was holding", "[pattern]") {
  // The rebuilt instance adopts the old one's held set. Without that the note on the playhead was
  // inside at the edit has no note off anywhere, and whatever is downstream holds it for ever.
  Rig rig(patternData("c4 e4 g4 b4"), {{"legato", 1.f}});
  rig.run(40);   // inside the third step: c4 and e4 have come and gone, g4 is sounding
  REQUIRE(rig.log.size() == 5);
  rig.edit(patternData("d4 f4 a4 c5"));
  rig.run(24);
  rig.runBlocks(1);
  requireBalanced(rig.log);
  // The step under the playhead changed, so g4 was released and a4 started, both at the edit.
  REQUIRE(rig.log.size() >= 7);
  CHECK_FALSE(rig.log[5].on());
  CHECK(rig.log[5].e.a == 67.f);
  CHECK(rig.log[5].frame == 40);
  CHECK(rig.log[6].on());
  CHECK(rig.log[6].e.a == 69.f);
  CHECK(rig.log[6].frame == 40);
}

TEST_CASE("editing the pattern keeps a step it did not touch sounding", "[pattern]") {
  Rig rig(patternData("c4 e4 g4 b4"), {{"legato", 1.f}});
  rig.run(40);
  REQUIRE(rig.log.size() == 5);
  rig.edit(patternData("c4 e4 g4 c5"));   // g4 is still the third step
  rig.run(24);
  requireBalanced(rig.log);
  // Nothing happened at the edit: g4 ran on to the end of its step and c5 took over there.
  REQUIRE(rig.log.size() == 7);
  CHECK_FALSE(rig.log[5].on());
  CHECK(rig.log[5].e.a == 67.f);
  CHECK(rig.log[5].frame == 48);
  CHECK(rig.log[5].e.noteId == rig.log[4].e.noteId);   // the off carries the id the old instance's on used
  CHECK(rig.log[6].on());
  CHECK(rig.log[6].e.a == 72.f);
  CHECK(rig.log[6].frame == 48);
}

TEST_CASE("running the pattern allocates nothing", "[pattern][rt]") {
  // The cycle query runs on the audio thread every time the playhead crosses a boundary. This is
  // the test that keeps that honest for the module as a whole.
  Rig rig(patternData("<c4 eb4>*2 [g3,b3] c4@2 e4(3,8)", "1 0.5 <0.8 0.2>"));
  rig.run();   // first block: prepare's allocations are already done, the cache is cold
  rig.log.clear();
  pg::test::resetRtViolations();
  {
    pg::test::RtScope guard;
    for (int i = 0; i < 16; ++i) rig.run();
  }
  CHECK(pg::test::rtViolations() == 0);
}

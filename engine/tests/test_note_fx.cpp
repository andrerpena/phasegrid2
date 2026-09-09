/*
 * The note effects: a note stream in, a different one out.
 *
 * Every one of them is checked for the rule the family exists to keep -- an off arrives for exactly
 * what an on produced, at the pitch it was produced at -- and then for what it does to the notes.
 */
#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <array>
#include <map>
#include <memory>
#include <string>
#include <vector>
#include "core/Module.hpp"
#include "modules/builtin.hpp"
#include "util/GraphFixture.hpp"
#include "util/RtGuard.hpp"

namespace {

constexpr double kSampleRate = 48000.0;
/// 45000 BPM is 750 beats a second, so one beat is exactly 64 samples at 48 kHz. The arpeggiator's
/// default rate is a sixteenth, a quarter of a beat: one step is exactly 16 frames.
constexpr double kTempo = 45000.0;
constexpr uint32_t kMaxPairs = 16;

struct Timed {
  uint64_t frame = 0;
  pg::Event e;
  bool on() const { return e.type == pg::EventType::NoteOn; }
};

/// Emits a script of events placed in absolute engine time, so a test can lay presses and releases
/// across block boundaries.
struct Script : pg::VoicedModule<int> {
  static inline std::vector<Timed> events;
  static inline uint64_t base = 0;
  void process(pg::ProcessContext& c) override {
    if (c.voice != 0) return;   // the buffer is shared by every pair; filling it once is enough
    for (const Timed& t : events) {
      if (t.frame < base || t.frame >= base + c.numFrames) continue;
      pg::Event e = t.e;
      e.frame = static_cast<uint32_t>(t.frame - base);
      c.eventOut(0).push(e);
    }
  }
};
const pg::PortDesc kScriptOut[] = {{"notes", "Notes", pg::PortKind::Event, 0, pg::SignalRole::Note, ""}};
const pg::ModuleDescriptor kScript{pg::kModuleAbiVersion, "test.noteScript", "NoteScript", "test", "",
  nullptr, 0, kScriptOut, 1, nullptr, 0, 0, 0, [] () -> pg::Module* { return new Script(); }, nullptr, 0};

struct EventLog {
  std::array<pg::Event, 256> events{};
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

Timed on(uint64_t frame, float note, float velocity = 0.8f, uint32_t id = 0) {
  Timed t;
  t.frame = frame;
  t.e.type = pg::EventType::NoteOn;
  t.e.a = note;
  t.e.b = velocity;
  t.e.noteId = id == 0 ? static_cast<uint32_t>(frame * 131 + static_cast<uint32_t>(note)) : id;
  return t;
}
Timed off(uint64_t frame, float note) {
  Timed t;
  t.frame = frame;
  t.e.type = pg::EventType::NoteOff;
  t.e.a = note;
  return t;
}

/// script -> the effect under test -> recorder.
struct Rig {
  pg::test::GraphFixture f;
  std::unique_ptr<pg::Program> program;
  std::vector<Timed> log;
  uint64_t pos = 0;

  Rig(const char* type, std::vector<Timed> script, std::map<std::string, float> params = {},
      uint32_t voices = 1) {
    pg::registerBuiltinModules(f.reg);
    REQUIRE_FALSE(f.reg.add(kScript).has_value());
    REQUIRE_FALSE(f.reg.add(kRecorder).has_value());
    Script::events = std::move(script);
    Script::base = 0;
    Recorder::perPair = {};
    log.reserve(2048);   // the RT test runs blocks inside an allocation guard
    f.node("src", "test.noteScript");
    f.node("fx", type, std::move(params));
    f.node("rec", "test.noteRecorder");
    f.edge("e0", "src.notes", "fx.notes");
    f.edge("e1", "fx.notes", "rec.notes");
    f.model.setVoiceCount(voices);
    f.transport.tempo = kTempo;
    program = f.compile(kSampleRate, 64);
  }

  void runAt(uint64_t samplePos, uint32_t frames = 64) {
    Recorder::perPair = {};
    Script::base = samplePos;
    f.transport.samplePos = samplePos;
    f.run(*program, frames);
    for (uint32_t i = 0; i < Recorder::perPair[0].count; ++i) {
      const pg::Event& e = Recorder::perPair[0].events[i];
      log.push_back(Timed{samplePos + e.frame, e});
    }
    pos = samplePos + frames;
  }
  void run(uint32_t frames = 64) { runAt(pos, frames); }
  void runBlocks(uint32_t n, uint32_t frames = 64) { for (uint32_t i = 0; i < n; ++i) run(frames); }

  std::vector<Timed> onsets() const {
    std::vector<Timed> out;
    for (const Timed& t : log) if (t.on()) out.push_back(t);
    return out;
  }
  std::vector<Timed> offs() const {
    std::vector<Timed> out;
    for (const Timed& t : log) if (!t.on()) out.push_back(t);
    return out;
  }
};

/// No pitch is ever on twice at once, and no off arrives for a pitch that is not sounding: the rule
/// the whole family is built to keep, since the converters downstream match offs to ons by pitch.
void requireBalanced(const std::vector<Timed>& log) {
  std::map<float, int> outstanding;
  uint64_t last = 0;
  for (const Timed& t : log) {
    INFO("event at frame " << t.frame << " after " << last);
    REQUIRE(t.frame >= last);
    last = t.frame;
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

// ---------------------------------------------------------------------------------------- chord

TEST_CASE("chord: one note in, a triad out, released together", "[notefx]") {
  Rig rig("notefx.chord", {on(4, 60.f, 0.7f), off(40, 60.f)});
  rig.run();
  const auto ons = rig.onsets();
  REQUIRE(ons.size() == 3);
  CHECK(ons[0].e.a == 60.f);
  CHECK(ons[1].e.a == 64.f);
  CHECK(ons[2].e.a == 67.f);
  for (const Timed& t : ons) {
    CHECK(t.frame == 4);
    CHECK(t.e.b == Catch::Approx(0.7));
  }
  CHECK(ons[0].e.noteId != ons[1].e.noteId);
  const auto offs = rig.offs();
  REQUIRE(offs.size() == 3);
  for (const Timed& t : offs) CHECK(t.frame == 40);
  requireQuiet(rig.log);
}

TEST_CASE("chord: the type is a select, and a seventh is four notes", "[notefx]") {
  Rig minor("notefx.chord", {on(0, 60.f)}, {{"chord", 1.f}});
  minor.run();
  REQUIRE(minor.onsets().size() == 3);
  CHECK(minor.onsets()[1].e.a == 63.f);

  Rig seventh("notefx.chord", {on(0, 60.f), off(10, 60.f)}, {{"chord", 8.f}});
  seventh.run();
  REQUIRE(seventh.onsets().size() == 4);
  CHECK(seventh.onsets()[3].e.a == 70.f);
  requireQuiet(seventh.log);
}

TEST_CASE("chord: a tone that clamps onto another is dropped, not doubled", "[notefx]") {
  Rig rig("notefx.chord", {on(0, 125.f), off(10, 125.f)});
  rig.run();
  // 125, 129 -> 127, 132 -> 127: the two clamped tones are one pitch, so one note.
  REQUIRE(rig.onsets().size() == 2);
  CHECK(rig.onsets()[1].e.a == 127.f);
  requireQuiet(rig.log);
}

TEST_CASE("chord: an off for a note never seen is ignored", "[notefx]") {
  Rig rig("notefx.chord", {off(0, 60.f)});
  rig.run();
  CHECK(rig.log.empty());
}

TEST_CASE("chord: every voice pair sees the same chord", "[notefx]") {
  Rig rig("notefx.chord", {on(0, 60.f)}, {}, 4);
  rig.run();
  REQUIRE(Recorder::perPair[0].count == 3);
  REQUIRE(Recorder::perPair[1].count == 3);
  CHECK(Recorder::perPair[1].events[2].a == 67.f);
}

// ------------------------------------------------------------------------------------- quantize

TEST_CASE("quantize: a chromatic project is a wire", "[notefx]") {
  Rig rig("notefx.quantize", {on(0, 61.f, 0.5f), off(20, 61.f)});
  rig.run();
  REQUIRE(rig.log.size() == 2);
  CHECK(rig.log[0].e.a == 61.f);
  CHECK(rig.log[0].e.b == Catch::Approx(0.5));
  CHECK(rig.log[1].e.a == 61.f);
}

TEST_CASE("quantize: notes snap to the project's scale, and the off follows the snapped pitch", "[notefx]") {
  Rig rig("notefx.quantize", {on(0, 61.f), off(20, 61.f), on(30, 66.f), off(50, 66.f)});
  rig.f.transport.scaleRoot = 0;
  rig.f.transport.scaleMask = 0b101010110101u;   // C major: C D E F G A B
  rig.run();
  const auto ons = rig.onsets();
  REQUIRE(ons.size() == 2);
  CHECK(ons[0].e.a == 60.f);   // C# to C: a tie, resolved downward
  CHECK(ons[1].e.a == 65.f);   // F# to F: the same tie, the same way
  const auto offs = rig.offs();
  REQUIRE(offs.size() == 2);
  CHECK(offs[0].e.a == 60.f);
  CHECK(offs[1].e.a == 65.f);
  requireQuiet(rig.log);
}

TEST_CASE("quantize: Down and Up always go their way", "[notefx]") {
  const uint32_t cMajor = 0b101010110101u;
  Rig down("notefx.quantize", {on(0, 66.f)}, {{"mode", 1.f}});
  down.f.transport.scaleMask = cMajor;
  down.run();
  CHECK(down.onsets()[0].e.a == 65.f);

  Rig up("notefx.quantize", {on(0, 66.f)}, {{"mode", 2.f}});
  up.f.transport.scaleMask = cMajor;
  up.run();
  CHECK(up.onsets()[0].e.a == 67.f);

  // Nearest with no tie: D# is closer to... equally far from D and E, so down; G# likewise to G.
  Rig nearest("notefx.quantize", {on(0, 63.f), on(1, 68.f)});
  nearest.f.transport.scaleMask = cMajor;
  nearest.run();
  CHECK(nearest.onsets()[0].e.a == 62.f);
  CHECK(nearest.onsets()[1].e.a == 67.f);
}

TEST_CASE("quantize: the root moves the scale", "[notefx]") {
  Rig rig("notefx.quantize", {on(0, 60.f)});
  rig.f.transport.scaleRoot = 2;                    // D major: D E F# G A B C#
  rig.f.transport.scaleMask = 0b101010110101u;
  rig.run();
  CHECK(rig.onsets()[0].e.a == 59.f);   // C is not in D major; B below and C# above both are, so down

  Rig up("notefx.quantize", {on(0, 60.f)}, {{"mode", 2.f}});
  up.f.transport.scaleRoot = 2;
  up.f.transport.scaleMask = 0b101010110101u;
  up.run();
  CHECK(up.onsets()[0].e.a == 61.f);
}

TEST_CASE("quantize: a key change under a held note releases the pitch that is sounding", "[notefx]") {
  Rig rig("notefx.quantize", {on(0, 61.f), off(100, 61.f)});
  rig.f.transport.scaleMask = 0b101010110101u;
  rig.run();
  REQUIRE(rig.onsets()[0].e.a == 60.f);
  rig.f.transport.scaleMask = 0xFFFu;   // chromatic again before the off arrives
  rig.run();
  REQUIRE(rig.offs().size() == 1);
  CHECK(rig.offs()[0].e.a == 60.f);
  requireQuiet(rig.log);
}

// ------------------------------------------------------------------------------------------ arp

TEST_CASE("arp: a held triad climbs one note per step, each held for the gate", "[notefx]") {
  Rig rig("notefx.arp", {on(0, 60.f, 0.9f), on(0, 64.f, 0.9f), on(0, 67.f, 0.9f)});
  rig.run();   // one block is four sixteenth steps of 16 frames
  const auto ons = rig.onsets();
  REQUIRE(ons.size() == 4);
  CHECK(ons[0].frame == 0);
  CHECK(ons[0].e.a == 60.f);
  CHECK(ons[0].e.b == Catch::Approx(0.9));
  CHECK(ons[1].frame == 16);
  CHECK(ons[1].e.a == 64.f);
  CHECK(ons[2].frame == 32);
  CHECK(ons[2].e.a == 67.f);
  CHECK(ons[3].frame == 48);
  CHECK(ons[3].e.a == 60.f);   // and round again
  const auto offs = rig.offs();
  REQUIRE(offs.size() == 4);
  CHECK(offs[0].frame == 8);   // gate 0.5 of a 16-frame step
  CHECK(offs[0].e.a == 60.f);
  CHECK(offs[1].frame == 24);
  requireBalanced(rig.log);
}

TEST_CASE("arp: Down and Up-Down and Octaves change the order", "[notefx]") {
  const std::vector<Timed> triad = {on(0, 60.f), on(0, 64.f), on(0, 67.f)};
  {
    Rig down("notefx.arp", triad, {{"mode", 1.f}});
    down.run();
    REQUIRE(down.onsets().size() == 4);
    CHECK(down.onsets()[0].e.a == 67.f);
    CHECK(down.onsets()[1].e.a == 64.f);
    CHECK(down.onsets()[2].e.a == 60.f);
    CHECK(down.onsets()[3].e.a == 67.f);
  }
  {
    Rig bounce("notefx.arp", triad, {{"mode", 2.f}});
    bounce.runBlocks(2);   // eight steps: 60 64 67 64 | 60 64 67 64
    REQUIRE(bounce.onsets().size() == 8);
    CHECK(bounce.onsets()[2].e.a == 67.f);
    CHECK(bounce.onsets()[3].e.a == 64.f);
    CHECK(bounce.onsets()[4].e.a == 60.f);
    CHECK(bounce.onsets()[5].e.a == 64.f);
  }
  {
    Rig octaves("notefx.arp", triad, {{"octaves", 2.f}});
    octaves.runBlocks(2);   // 60 64 67 72 | 76 79 60 64
    REQUIRE(octaves.onsets().size() == 8);
    CHECK(octaves.onsets()[3].e.a == 72.f);
    CHECK(octaves.onsets()[5].e.a == 79.f);
    CHECK(octaves.onsets()[6].e.a == 60.f);
    requireBalanced(octaves.log);
  }
  {
    // As played keeps the order of the presses, whatever their pitch.
    Rig played("notefx.arp", {on(0, 67.f), on(0, 60.f), on(0, 64.f)}, {{"mode", 3.f}});
    played.run();
    CHECK(played.onsets()[0].e.a == 67.f);
    CHECK(played.onsets()[1].e.a == 60.f);
    CHECK(played.onsets()[2].e.a == 64.f);
  }
}

TEST_CASE("arp: Random stays within the held notes", "[notefx]") {
  Rig rig("notefx.arp", {on(0, 60.f), on(0, 64.f), on(0, 67.f)}, {{"mode", 4.f}});
  rig.runBlocks(8);
  REQUIRE(rig.onsets().size() == 32);
  bool sawEach[3] = {false, false, false};
  for (const Timed& t : rig.onsets()) {
    CHECK((t.e.a == 60.f || t.e.a == 64.f || t.e.a == 67.f));
    if (t.e.a == 60.f) sawEach[0] = true;
    if (t.e.a == 64.f) sawEach[1] = true;
    if (t.e.a == 67.f) sawEach[2] = true;
  }
  CHECK((sawEach[0] && sawEach[1] && sawEach[2]));
  requireBalanced(rig.log);
}

TEST_CASE("arp: releasing every note stops the one that is sounding, and the next chord restarts", "[notefx]") {
  Rig rig("notefx.arp", {on(0, 60.f), on(0, 64.f), off(4, 60.f), off(4, 64.f), on(40, 67.f), on(40, 71.f)},
          {{"gate", 1.f}});
  rig.run();
  // 60 starts at 0 and is cut at 4 when the chord is let go; nothing until the step after 40.
  REQUIRE(rig.log.size() >= 2);
  CHECK(rig.log[0].on());
  CHECK(rig.log[0].e.a == 60.f);
  CHECK_FALSE(rig.log[1].on());
  CHECK(rig.log[1].frame == 4);
  const auto ons = rig.onsets();
  REQUIRE(ons.size() == 2);
  CHECK(ons[1].frame == 48);   // a note that arrives mid-step waits for the boundary
  CHECK(ons[1].e.a == 67.f);   // and the new chord starts from its own first note
  requireBalanced(rig.log);
}

TEST_CASE("arp: a note that arrives on a step boundary sounds on that step", "[notefx]") {
  Rig rig("notefx.arp", {on(16, 60.f)});
  rig.run();
  REQUIRE(rig.onsets().size() == 3);
  CHECK(rig.onsets()[0].frame == 16);
}

TEST_CASE("arp: a jump backwards releases what was sounding", "[notefx]") {
  Rig rig("notefx.arp", {on(0, 60.f), on(0, 64.f)}, {{"gate", 1.f}});
  // Playing, the arpeggiator follows the musical position, which a seek can move backwards while
  // engine time keeps going forwards.
  rig.f.transport.playing = true;
  rig.f.transport.ppq = 0.0;
  rig.run();
  REQUIRE(rig.onsets().size() == 4);
  rig.f.transport.ppq = 0.0;   // seek to the start
  rig.run();
  requireBalanced(rig.log);
  // The note from before the seek is released on the first frame after it, and the run restarts.
  REQUIRE(rig.log.size() >= 9);
  CHECK(rig.log[7].frame == 64);
  CHECK_FALSE(rig.log[7].on());
  CHECK(rig.log[8].frame == 64);
  CHECK(rig.log[8].on());
}

TEST_CASE("arp: with a gate of one, a note ends exactly where the next begins", "[notefx]") {
  Rig rig("notefx.arp", {on(0, 60.f), on(0, 64.f)}, {{"gate", 1.f}});
  rig.run();
  REQUIRE(rig.log.size() >= 4);
  CHECK(rig.log[0].on());
  CHECK(rig.log[1].frame == 16);
  CHECK_FALSE(rig.log[1].on());
  CHECK(rig.log[2].frame == 16);
  CHECK(rig.log[2].on());
  requireBalanced(rig.log);
}

// ------------------------------------------------------------------------------------- humanize

TEST_CASE("humanize: with both knobs at zero it is a wire", "[notefx]") {
  Rig rig("notefx.humanize", {on(3, 60.f, 0.6f), off(30, 60.f), on(70, 64.f, 0.3f), off(90, 64.f)},
          {{"timing", 0.f}, {"velocity", 0.f}});
  rig.runBlocks(2);
  REQUIRE(rig.log.size() == 4);
  CHECK(rig.log[0].frame == 3);
  CHECK(rig.log[0].e.b == Catch::Approx(0.6));
  CHECK(rig.log[1].frame == 30);
  CHECK(rig.log[2].frame == 70);
  CHECK(rig.log[2].e.b == Catch::Approx(0.3));
  CHECK(rig.log[3].frame == 90);
  requireQuiet(rig.log);
}

TEST_CASE("humanize: a note is moved whole, never early, and its length is kept", "[notefx]") {
  std::vector<Timed> script;
  for (uint64_t k = 0; k < 8; ++k) {
    script.push_back(on(k * 40, 60.f + static_cast<float>(k), 0.5f));
    script.push_back(off(k * 40 + 20, 60.f + static_cast<float>(k)));
  }
  Rig rig("notefx.humanize", script, {{"timing", 0.1f}, {"velocity", 0.5f}});
  rig.runBlocks(100);   // a tenth of a second is 75 blocks; the last note may be that late
  const auto ons = rig.onsets();
  const auto offs = rig.offs();
  REQUIRE(ons.size() == 8);
  REQUIRE(offs.size() == 8);
  bool moved = false;
  for (size_t k = 0; k < 8; ++k) {
    // A late note may come out after an earlier one that was moved less, so match by pitch.
    const float pitch = 60.f + static_cast<float>(k);
    const uint64_t source = k * 40;
    const Timed* onAt = nullptr;
    const Timed* offAt = nullptr;
    for (const Timed& t : ons) if (t.e.a == pitch) onAt = &t;
    for (const Timed& t : offs) if (t.e.a == pitch) offAt = &t;
    REQUIRE(onAt != nullptr);
    REQUIRE(offAt != nullptr);
    CHECK(onAt->frame >= source);
    CHECK(onAt->frame <= source + 4800);   // 0.1 s at 48 kHz
    CHECK(offAt->frame - onAt->frame == 20);
    CHECK(onAt->e.b >= 0.25f);
    CHECK(onAt->e.b <= 0.75f);
    moved = moved || onAt->frame != source || onAt->e.b != 0.5f;
  }
  CHECK(moved);
  requireQuiet(rig.log);
}

TEST_CASE("humanize: the same performance every time", "[notefx]") {
  const std::vector<Timed> script = {on(0, 60.f), off(10, 60.f), on(20, 62.f), off(30, 62.f)};
  Rig a("notefx.humanize", script, {{"timing", 0.05f}, {"velocity", 0.5f}});
  Rig b("notefx.humanize", script, {{"timing", 0.05f}, {"velocity", 0.5f}});
  a.runBlocks(40);
  b.runBlocks(40);
  REQUIRE(a.log.size() == b.log.size());
  for (size_t k = 0; k < a.log.size(); ++k) {
    CHECK(a.log[k].frame == b.log[k].frame);
    CHECK(a.log[k].e.b == b.log[k].e.b);
  }
}

TEST_CASE("humanize: a note never becomes silent", "[notefx]") {
  Rig rig("notefx.humanize", {on(0, 60.f, 0.02f), on(1, 61.f, 0.02f), on(2, 62.f, 0.02f), on(3, 63.f, 0.02f)},
          {{"timing", 0.f}, {"velocity", 1.f}});
  rig.run();
  REQUIRE(rig.onsets().size() == 4);
  for (const Timed& t : rig.onsets()) CHECK(t.e.b >= 0.01f);
}

// ------------------------------------------------------------------------------------------- rt

TEST_CASE("the note effects allocate nothing while running", "[notefx][rt]") {
  for (const char* type : {"notefx.chord", "notefx.quantize", "notefx.arp", "notefx.humanize"}) {
    std::vector<Timed> script;
    for (uint64_t k = 0; k < 64; ++k) {
      script.push_back(on(k * 30, 48.f + static_cast<float>(k % 24)));
      script.push_back(off(k * 30 + 15, 48.f + static_cast<float>(k % 24)));
    }
    std::map<std::string, float> params;
    if (std::string(type) == "notefx.humanize") params["timing"] = 0.05f;
    Rig rig(type, script, params);
    rig.f.transport.scaleMask = 0b101010110101u;
    rig.runBlocks(40);   // far enough for the humanizer's delayed notes to have come out
    INFO(type);
    REQUIRE_FALSE(rig.log.empty());   // it really did run, so the check below is not measuring silence
    pg::test::resetRtViolations();
    { pg::test::RtScope scope; rig.runBlocks(60); }
    REQUIRE(pg::test::rtViolations() == 0);
  }
}

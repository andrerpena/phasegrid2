#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <vector>
#include "core/Engine.hpp"
#include "modules/TestModules.hpp"
#include "modules/builtin.hpp"
#include "util/GraphFixture.hpp"
#include "util/RtGuard.hpp"

namespace {

/// Emits a fixed script of note events in the first block and nothing afterwards, so a test can lay out
/// presses and releases at exact frames.
struct NoteGen : pg::VoicedModule<int> {
  static inline std::vector<pg::Event> script;
  static inline int block = 0;
  void process(pg::ProcessContext& c) override {
    if (block++ != 0) return;
    for (const pg::Event& e : script) c.eventOut(0).push(e);
  }
};
const pg::PortDesc kNoteGenOut[] = {{"notes", "Notes", pg::PortKind::Event, 0, pg::SignalRole::Any, ""}};
const pg::ModuleDescriptor kNoteGen{pg::kModuleAbiVersion, "test.noteGen", "NoteGen", "test", "",
  nullptr, 0, kNoteGenOut, 1, nullptr, 0, 0, 0, [] () -> pg::Module* { return new NoteGen(); }};

pg::Event noteOn(uint32_t frame, float note, float velocity) {
  pg::Event e;
  e.frame = frame;
  e.type = pg::EventType::NoteOn;
  e.a = note;
  e.b = velocity;
  return e;
}
pg::Event noteOff(uint32_t frame, float note) {
  pg::Event e;
  e.frame = frame;
  e.type = pg::EventType::NoteOff;
  e.a = note;
  return e;
}

/// A fixture wired gen -> note.toCv, with the script already installed.
struct Rig {
  pg::test::GraphFixture f;
  std::unique_ptr<pg::Program> program;

  Rig(std::vector<pg::Event> script, std::map<std::string, float> params) {
    pg::registerBuiltinModules(f.reg);
    REQUIRE_FALSE(f.reg.add(kNoteGen).has_value());
    NoteGen::block = 0;
    NoteGen::script = std::move(script);
    f.node("gen", "test.noteGen");
    f.node("cv", "note.toCv", std::move(params));
    f.edge("e", "gen.notes", "cv.notes");
    program = f.compile();
  }
  void run(uint32_t frames = 64) { f.run(*program, frames); }
  float out(const char* port, uint32_t frame, uint32_t lane = 0) { return f.out(*program, "cv", port, frame, lane); }
};

}  // namespace

TEST_CASE("note.toCv: gate, pitch, velocity and the retrigger dip", "[modules]") {
  Rig rig({noteOn(2, 60.f, 0.5f), noteOn(10, 72.f, 1.0f), noteOff(20, 72.f), noteOff(30, 60.f)},
          {{"glide", 0.f}});
  rig.run();

  REQUIRE(rig.out("gate", 1) == 0.f);
  REQUIRE(rig.out("gate", 2) == 1.f);
  REQUIRE(rig.out("pitch", 2) == Catch::Approx(0.f));      // MIDI 60 is pitch 0
  REQUIRE(rig.out("velocity", 2) == Catch::Approx(0.5f));

  REQUIRE(rig.out("gate", 10) == 0.f);                      // a new note while one is held: one frame low
  REQUIRE(rig.out("gate", 11) == 1.f);
  REQUIRE(rig.out("pitch", 11) == Catch::Approx(0.1f));     // MIDI 72 is one octave up
  REQUIRE(rig.out("velocity", 11) == Catch::Approx(1.f));

  REQUIRE(rig.out("gate", 21) == 1.f);                      // the older note is still held
  REQUIRE(rig.out("pitch", 21) == Catch::Approx(0.f));
  REQUIRE(rig.out("gate", 31) == 0.f);
  REQUIRE(rig.out("pitch", 31) == Catch::Approx(0.f));      // pitch holds through the release

  REQUIRE(rig.out("gate", 2, 2) == 0.f);                    // voice 1 lanes stay silent
  REQUIRE(rig.out("pitch", 11, 3) == 0.f);
}

TEST_CASE("note.toCv: priority mode picks which held note sounds", "[modules]") {
  const std::vector<pg::Event> chord = {noteOn(2, 60.f, 1.f), noteOn(4, 72.f, 1.f), noteOn(6, 48.f, 1.f)};
  {
    Rig last(chord, {{"glide", 0.f}, {"mode", 0.f}});
    last.run();
    REQUIRE(last.out("pitch", 8) == Catch::Approx(-0.1f));   // newest press: MIDI 48
  }
  {
    Rig low(chord, {{"glide", 0.f}, {"mode", 1.f}});
    low.run();
    REQUIRE(low.out("pitch", 8) == Catch::Approx(-0.1f));    // lowest held is also 48
    REQUIRE(low.out("pitch", 5) == Catch::Approx(0.f));      // ...but at frame 5 only 60 and 72 are down
  }
  {
    Rig high(chord, {{"glide", 0.f}, {"mode", 2.f}});
    high.run();
    REQUIRE(high.out("pitch", 8) == Catch::Approx(0.1f));    // highest held: MIDI 72
  }
}

TEST_CASE("note.toCv: glide slides between notes instead of jumping", "[modules]") {
  Rig rig({noteOn(0, 60.f, 1.f), noteOn(4, 72.f, 1.f)}, {{"glide", 0.01f}});
  rig.run();
  const float immediately = rig.out("pitch", 5);
  const float later = rig.out("pitch", 40);
  REQUIRE(immediately > 0.f);
  REQUIRE(immediately < 0.05f);            // nowhere near the target one frame in
  REQUIRE(later > immediately);
  REQUIRE(later < 0.1f);                   // still on its way after 36 frames of a 10 ms time constant
}

TEST_CASE("note.toCv is allocation free", "[modules][rt]") {
  Rig rig({noteOn(2, 60.f, 0.7f), noteOff(40, 60.f)}, {{"glide", 0.05f}});
  rig.run();
  REQUIRE(rig.out("gate", 3) == 1.f);   // it really did play, so the check below is not measuring silence
  pg::test::resetRtViolations();
  { pg::test::RtScope scope; for (int i = 0; i < 200; ++i) rig.run(); }
  REQUIRE(pg::test::rtViolations() == 0);
}

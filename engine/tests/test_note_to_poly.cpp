#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <array>
#include <vector>
#include "core/Module.hpp"
#include "modules/TestModules.hpp"
#include "modules/builtin.hpp"
#include "util/GraphFixture.hpp"
#include "util/RtGuard.hpp"

namespace {

constexpr uint32_t kProbeVoices = 32;   // kMaxVoices: the probe sizes its capture for the largest program

/// Emits a fixed script of note events in the first block and nothing afterwards, so a test can lay out
/// presses and releases at exact frames.
struct NoteGen : pg::VoicedModule<int> {
  static inline std::vector<pg::Event> script;
  static inline int block = 0;
  void process(pg::ProcessContext& c) override {
    if (c.voice != 0) return;   // the event buffer is shared by every pair; filling it once is enough
    if (block++ != 0) return;
    for (const pg::Event& e : script) c.eventOut(0).push(e);
  }
};
const pg::PortDesc kNoteGenOut[] = {{"notes", "Notes", pg::PortKind::Event, 0, pg::SignalRole::Note, ""}};
const pg::ModuleDescriptor kNoteGen{pg::kModuleAbiVersion, "test.noteGen", "NoteGen", "test", "",
  nullptr, 0, kNoteGenOut, 1, nullptr, 0, 0, 0, [] () -> pg::Module* { return new NoteGen(); }};

/// Records pitch, gate and velocity per VOICE. Every pair writes the same shared buffers, so only the last
/// pair's values are still there once a block has run -- the only way to see what pair 0 produced is to look
/// while pair 0 is running, which is what this does.
struct Probe : pg::VoicedModule<int> {
  static inline std::array<std::array<std::array<float, pg::kMaxBlockSize>, 3>, kProbeVoices> captured{};
  void process(pg::ProcessContext& c) override {
    for (uint32_t l = 0; l < 2; ++l) {
      const uint32_t v = 2 * c.voice + l;
      if (v >= kProbeVoices) return;
      for (uint32_t port = 0; port < 3; ++port) {
        const pg::Sample* in = c.in(port).readOr();
        for (uint32_t i = 0; i < c.numFrames; ++i) captured[v][port][i] = pg::lanes::lane(in[i], 2 * l);
      }
    }
  }
};
const pg::PortDesc kProbeIn[] = {
  {"pitch", "Pitch", pg::PortKind::Continuous, 1, pg::SignalRole::Pitch, ""},
  {"gate", "Gate", pg::PortKind::Continuous, 1, pg::SignalRole::Gate, ""},
  {"velocity", "Velocity", pg::PortKind::Continuous, 1, pg::SignalRole::Cv, ""},
};
const pg::ModuleDescriptor kProbe{pg::kModuleAbiVersion, "test.voiceProbe", "VoiceProbe", "test", "",
  kProbeIn, 3, nullptr, 0, nullptr, 0, 0, 0, [] () -> pg::Module* { return new Probe(); }};

pg::Event noteOn(uint32_t frame, float note, float velocity) {
  pg::Event e; e.frame = frame; e.type = pg::EventType::NoteOn; e.a = note; e.b = velocity;
  return e;
}
pg::Event noteOff(uint32_t frame, float note) {
  pg::Event e; e.frame = frame; e.type = pg::EventType::NoteOff; e.a = note;
  return e;
}

/// gen -> note.toPoly -> probe, with the script installed and the voice count set.
struct Rig {
  pg::test::GraphFixture f;
  std::unique_ptr<pg::Program> program;

  Rig(uint32_t voices, std::vector<pg::Event> script) {
    pg::registerBuiltinModules(f.reg);
    REQUIRE_FALSE(f.reg.add(kNoteGen).has_value());
    REQUIRE_FALSE(f.reg.add(kProbe).has_value());
    NoteGen::block = 0;
    NoteGen::script = std::move(script);
    Probe::captured = {};
    REQUIRE(f.model.setVoiceCount(voices));
    f.node("gen", "test.noteGen");
    f.node("poly", "note.toPoly");
    f.node("probe", "test.voiceProbe");
    f.edge("e0", "gen.notes", "poly.notes");
    f.edge("e1", "poly.pitch", "probe.pitch");
    f.edge("e2", "poly.gate", "probe.gate");
    f.edge("e3", "poly.velocity", "probe.velocity");
    program = f.compile();
  }
  void run(uint32_t frames = 64) { f.run(*program, frames); }
  float pitch(uint32_t voice, uint32_t frame) { return Probe::captured[voice][0][frame]; }
  float gate(uint32_t voice, uint32_t frame) { return Probe::captured[voice][1][frame]; }
  float velocity(uint32_t voice, uint32_t frame) { return Probe::captured[voice][2][frame]; }
  uint32_t sounding(uint32_t frame) {
    uint32_t n = 0;
    for (uint32_t v = 0; v < kProbeVoices; ++v) n += gate(v, frame) > 0.f ? 1u : 0u;
    return n;
  }
};

}  // namespace

TEST_CASE("note.toPoly gives a chord one voice per note", "[modules]") {
  Rig rig(4, {noteOn(2, 60.f, 0.25f), noteOn(4, 64.f, 0.5f), noteOn(6, 67.f, 1.f)});
  rig.run();

  REQUIRE(rig.sounding(1) == 0);
  REQUIRE(rig.sounding(3) == 1);
  REQUIRE(rig.sounding(5) == 2);
  REQUIRE(rig.sounding(8) == 3);        // three notes, three voices, all still down

  REQUIRE(rig.pitch(0, 8) == Catch::Approx(0.f));            // MIDI 60 is pitch 0
  REQUIRE(rig.pitch(1, 8) == Catch::Approx(4.f / 120.f));    // 64: four semitones up
  REQUIRE(rig.pitch(2, 8) == Catch::Approx(7.f / 120.f));    // 67
  REQUIRE(rig.velocity(0, 8) == Catch::Approx(0.25f));
  REQUIRE(rig.velocity(1, 8) == Catch::Approx(0.5f));
  REQUIRE(rig.velocity(2, 8) == Catch::Approx(1.f));
  REQUIRE(rig.gate(3, 8) == 0.f);                            // the fourth voice was never touched

  // The notes land in different lanes of different pairs: voices 0 and 1 are pair 0, voice 2 is pair 1.
  REQUIRE(rig.gate(0, 3) == 1.f);
  REQUIRE(rig.gate(1, 3) == 0.f);                            // 64 has not been pressed at frame 3
  REQUIRE(rig.gate(1, 5) == 1.f);
  REQUIRE(rig.gate(2, 5) == 0.f);
  REQUIRE(rig.gate(2, 7) == 1.f);
}

TEST_CASE("note.toPoly steals the oldest sounding voice once every voice is busy", "[modules]") {
  Rig rig(3, {noteOn(2, 60.f, 1.f), noteOn(4, 64.f, 1.f), noteOn(6, 67.f, 1.f), noteOn(20, 72.f, 0.75f)});
  rig.run();

  REQUIRE(rig.sounding(8) == 3);
  REQUIRE(rig.sounding(30) == 3);                             // still three: the fourth note took a voice
  REQUIRE(rig.pitch(0, 30) == Catch::Approx(1.f / 10.f));     // voice 0 held the oldest note and now plays 72
  REQUIRE(rig.velocity(0, 30) == Catch::Approx(0.75f));
  REQUIRE(rig.gate(0, 20) == 0.f);                            // the steal drops the gate for exactly one frame
  REQUIRE(rig.gate(0, 19) == 1.f);
  REQUIRE(rig.gate(0, 21) == 1.f);
  REQUIRE(rig.pitch(1, 30) == Catch::Approx(4.f / 120.f));    // the other two are untouched
  REQUIRE(rig.pitch(2, 30) == Catch::Approx(7.f / 120.f));
}

TEST_CASE("note.toPoly frees the voice the released note was on and no other", "[modules]") {
  Rig rig(4, {noteOn(2, 60.f, 1.f), noteOn(4, 64.f, 1.f), noteOn(6, 67.f, 1.f), noteOff(20, 64.f)});
  rig.run();

  REQUIRE(rig.sounding(19) == 3);
  REQUIRE(rig.sounding(21) == 2);
  REQUIRE(rig.gate(1, 21) == 0.f);                            // 64 was on voice 1
  REQUIRE(rig.gate(0, 21) == 1.f);
  REQUIRE(rig.gate(2, 21) == 1.f);
  REQUIRE(rig.pitch(1, 21) == Catch::Approx(4.f / 120.f));    // pitch holds through the release
  REQUIRE(rig.velocity(1, 21) == Catch::Approx(1.f));
}

TEST_CASE("note.toPoly gives a stolen note's release to no one", "[modules]") {
  // 60 is stolen by 72 at frame 20; its note off at 30 must not silence the voice 72 is now using.
  Rig rig(2, {noteOn(2, 60.f, 1.f), noteOn(4, 64.f, 1.f), noteOn(20, 72.f, 1.f), noteOff(30, 60.f)});
  rig.run();

  REQUIRE(rig.sounding(25) == 2);
  REQUIRE(rig.sounding(35) == 2);                             // the stale note off frees nothing
  REQUIRE(rig.pitch(0, 35) == Catch::Approx(1.f / 10.f));     // voice 0 is still playing 72
  REQUIRE(rig.gate(0, 35) == 1.f);
  REQUIRE(rig.gate(1, 35) == 1.f);
}

TEST_CASE("note.toPoly holds its voices across block boundaries", "[modules]") {
  Rig rig(4, {noteOn(2, 60.f, 1.f), noteOn(4, 64.f, 1.f)});
  rig.run();
  rig.run();
  REQUIRE(rig.sounding(0) == 2);
  REQUIRE(rig.sounding(63) == 2);
  REQUIRE(rig.pitch(0, 63) == Catch::Approx(0.f));
  REQUIRE(rig.pitch(1, 63) == Catch::Approx(4.f / 120.f));
}

TEST_CASE("note.toPoly never puts a note on the lane an odd voice count leaves empty", "[modules]") {
  // Three voices is two pairs, and the top lane of pair 1 carries no voice. A note landing there would be
  // masked away at the terminal, so it would go silently missing rather than steal a voice that can sound.
  Rig rig(3, {noteOn(2, 60.f, 1.f), noteOn(4, 64.f, 1.f), noteOn(6, 67.f, 1.f), noteOn(20, 72.f, 1.f)});
  rig.run();
  REQUIRE(rig.gate(2, 8) == 1.f);                             // voice 2 is the low lane of pair 1
  REQUIRE(rig.gate(3, 8) == 0.f);                             // the pair's other lane holds no voice at all
  REQUIRE(rig.gate(3, 30) == 0.f);
  REQUIRE(rig.pitch(3, 30) == 0.f);
  REQUIRE(rig.velocity(3, 30) == 0.f);
  REQUIRE(rig.pitch(0, 30) == Catch::Approx(1.f / 10.f));     // the fourth note stole a real voice instead
}

TEST_CASE("note.toPoly is allocation free", "[modules][rt]") {
  Rig rig(8, {noteOn(2, 60.f, 1.f), noteOn(4, 64.f, 1.f), noteOn(6, 67.f, 1.f), noteOff(40, 64.f)});
  rig.run();
  REQUIRE(rig.sounding(8) == 3);   // it really did play, so the check below is not measuring silence
  pg::test::resetRtViolations();
  {
    pg::test::RtScope scope;
    for (int i = 0; i < 200; ++i) rig.run();
  }
  REQUIRE(pg::test::rtViolations() == 0);
}

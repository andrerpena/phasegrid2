#include <catch2/catch_test_macros.hpp>
#include <algorithm>
#include <array>
#include <cmath>
#include <memory>
#include "core/Voices.hpp"
#include "modules/builtin.hpp"
#include "util/GraphFixture.hpp"

/**
 * When a released voice ends. The rule is the reference instrument's: a voice lives while its note is
 * held, and after the note off only while something in the instrument holds it -- an envelope until its
 * release is over, an exit asked to until it hears silence. Nothing holding it, it is free at the end
 * of the block its note ended in.
 *
 * The rig is the patch that found the bug: a pattern of single notes into a converter, a sine that
 * never goes quiet on its own, and the output. Before this rule that sine droned on every voice it was
 * ever given, one more per note, until the pool was full.
 */
namespace {

struct Rig {
  pg::test::GraphFixture f;
  std::unique_ptr<pg::Program> program;
  alignas(16) std::array<pg::Sample, 64> busData{};
  pg::AudioBus bus{busData.data(), 64};

  /// `envelope`: a gate-driven envelope into a VCA between the sine and the output, `release` seconds
  /// long, with `envLifetime` deciding whether it has a say. `outLifetime`: the output's own toggle.
  Rig(bool envelope, float release = 1.f, float envLifetime = 1.f, float outLifetime = 0.f) {
    pg::registerBuiltinModules(f.reg);
    f.node("pat", "notes.pattern", {{"legato", 0.125f}, {"cycle", 5.f}});   // one block of note per cycle of eight
    REQUIRE(f.model.setNodeData("pat", nlohmann::json{{"pattern", "c3"}}));
    f.node("poly", "note.toPoly", {{"voices", 4.f}});
    f.node("osc", "osc.sine");
    f.node("out", "io.audioOut", {{"lifetime", outLifetime}});
    f.edge("e0", "pat.notes", "poly.notes");
    f.edge("e1", "poly.pitch", "osc.pitch");
    if (envelope) {
      f.node("env", "env.dahdsr", {{"attack", 0.f}, {"decay", 0.f}, {"sustain", 1.f}, {"release", release}, {"lifetime", envLifetime}});
      f.node("vca", "amp.vca", {{"gain", 0.f}});
      f.edge("e2", "poly.gate", "env.gate");
      f.edge("e3", "osc.out", "vca.in");
      f.edge("e4", "env.out", "vca.gain");
      f.edge("e5", "vca.out", "out.inL");
    } else {
      f.edge("e5", "osc.out", "out.inL");
    }
    f.transport.tempo = 45000.0;   // one beat is exactly one 64-frame block at 48 kHz
    program = f.compile(48000.0, 64);
  }
  const pg::VoiceActivity& activity() const { return *program->instruments[0].activity; }
  void block(uint64_t index) {
    busData.fill(pg::Sample(0.f));
    f.transport.samplePos = 64 * index;
    f.run(*program, 64, &bus);
  }
  float peak() const {
    float p = 0.f;
    for (const pg::Sample& s : busData) p = std::max(p, std::max(std::fabs(s[0]), std::fabs(s[1])));
    return p;
  }
};

}  // namespace

TEST_CASE("A voice with nothing to hold it ends with its note, and the next note takes the same voice", "[voices]") {
  Rig rig(false);
  rig.block(0);
  REQUIRE(rig.activity().state(0) == pg::VoiceState::Held);
  REQUIRE(rig.peak() > 0.5f);
  // The note ends at the top of block 1: the voice runs that block as releasing, and nothing holds it.
  rig.block(1);
  REQUIRE(rig.activity().state(0) == pg::VoiceState::Free);
  // The sine is gone from the output with the voice: no drone.
  rig.block(2);
  REQUIRE(rig.peak() == 0.f);
  // The next cycle's note goes back to voice 0, not to voice 1: one voice for a run of single notes.
  rig.block(8);
  REQUIRE(rig.activity().state(0) == pg::VoiceState::Held);
  REQUIRE(rig.activity().state(1) == pg::VoiceState::Free);
}

TEST_CASE("An envelope holds the voice until its release is over", "[voices]") {
  Rig rig(true, 1.f);   // a one-second release: 750 blocks
  rig.block(0);
  rig.block(1);
  REQUIRE(rig.activity().state(0) == pg::VoiceState::Releasing);
  // Well into the release the voice is still there, still audible, and the pair still runs.
  for (uint64_t b = 2; b < 100; ++b) rig.block(b);
  REQUIRE(rig.activity().state(0) == pg::VoiceState::Releasing);
  REQUIRE(rig.peak() > 0.f);
  // Once the release has run out the envelope lets go and the voice is free.
  for (uint64_t b = 100; b < 1100; ++b) {
    // Skip the pattern's next notes: they would only revive the voice. The pattern is a global module
    // that keeps playing, so run the release out well past where it ends and look at the state after.
    if (b % 8 == 0) continue;
    rig.block(b);
  }
  REQUIRE(rig.activity().state(0) == pg::VoiceState::Free);
}

TEST_CASE("An envelope taken out of the decision does not hold the voice", "[voices]") {
  Rig rig(true, 1.f, /*envLifetime=*/0.f);
  rig.block(0);
  rig.block(1);
  REQUIRE(rig.activity().state(0) == pg::VoiceState::Free);
}

TEST_CASE("The output asked to affect voice lifetime holds a voice for as long as it hears it", "[voices]") {
  Rig rig(false, 1.f, 1.f, /*outLifetime=*/1.f);
  rig.block(0);
  rig.block(1);
  // The sine never falls silent, so the output never lets the voice go: this is the drone, chosen.
  for (uint64_t b = 2; b < 8; ++b) rig.block(b);
  REQUIRE(rig.activity().state(0) == pg::VoiceState::Releasing);
  REQUIRE(rig.peak() > 0.5f);
  // And the next note, finding voice 0 busy, takes voice 1.
  rig.block(8);
  REQUIRE(rig.activity().state(0) == pg::VoiceState::Releasing);
  REQUIRE(rig.activity().state(1) == pg::VoiceState::Held);
}

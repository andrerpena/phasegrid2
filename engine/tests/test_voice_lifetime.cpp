#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <algorithm>
#include <array>
#include <cmath>
#include <memory>
#include <vector>
#include "core/Voices.hpp"
#include "modules/builtin.hpp"
#include "util/GraphFixture.hpp"

/**
 * When a released voice ends, and how it ends.
 *
 * The rule is the reference instrument's: a voice lives while its note is held, and after the note off
 * only while something in the instrument holds it -- an envelope until its release is over, an exit
 * asked to until it hears silence. Nothing holding it, it ramps to silence over `kVoiceFadeSeconds` and
 * is free.
 *
 * The rig is the patch that found both halves of this: a pattern of notes into a converter, a sine that
 * never goes quiet on its own, and the output. Before the rule, that sine droned on every voice it was
 * ever given, one more per note, until the pool was full. Before the ramp, every note ended on a
 * full-scale step, which is a click, and the tests could not tell because a signal made of clicks has a
 * perfectly ordinary peak. Hence `maxStep`, which is what a click actually is.
 */
namespace {

constexpr uint32_t kBlock = 64;
/// A note of about 85 ms rather than of one block: what the ear is actually given.
constexpr double kMusicalTempo = 45000.0 / 32.0;

struct Rig {
  pg::test::GraphFixture f;
  std::unique_ptr<pg::Program> program;
  alignas(16) std::array<pg::Sample, kBlock> busData{};
  pg::AudioBus bus{busData.data(), kBlock};
  std::vector<float> left;   // every frame rendered so far, folded to one channel

  /// `envelope`: a gate-driven envelope into a VCA between the sine and the output, `release` seconds
  /// long, with `envLifetime` deciding whether it has a say. `outLifetime`: the output's own toggle.
  /// `tempo` is absurd on purpose: at 45000 one beat is exactly one block, which is what lets a test
  /// say "the note ends at the top of block 1". The tests that listen rather than count states use a
  /// thirty-second of it, so a note lasts long enough to be a note.
  Rig(bool envelope, float release = 1.f, float envLifetime = 1.f, float outLifetime = 0.f,
      const char* pattern = "c3", float legato = 0.125f, double tempo = 45000.0) {
    pg::registerBuiltinModules(f.reg);
    f.node("pat", "notes.pattern", {{"legato", legato}, {"cycle", 5.f}});   // eight blocks to the cycle
    REQUIRE(f.model.setNodeData("pat", nlohmann::json{{"pattern", pattern}}));
    f.node("poly", "note.toPoly", {{"voices", 4.f}});
    f.node("osc", "osc.sine");
    f.node("out", "io.audioOut", {{"lifetime", outLifetime}});
    f.edge("e0", "pat.notes", "poly.notes");
    f.edge("e1", "poly.pitch", "osc.pitch");
    if (envelope) {
      f.node("env", "env.dahdsr",
             {{"attack", 0.f}, {"decay", 0.f}, {"sustain", 1.f}, {"release", release}, {"lifetime", envLifetime}});
      f.node("vca", "amp.vca", {{"gain", 0.f}});
      f.edge("e2", "poly.gate", "env.gate");
      f.edge("e3", "osc.out", "vca.in");
      f.edge("e4", "env.out", "vca.gain");
      f.edge("e5", "vca.out", "out.inL");
    } else {
      f.edge("e5", "osc.out", "out.inL");
    }
    f.transport.tempo = tempo;
    program = f.compile(48000.0, kBlock);
  }

  const pg::VoiceActivity& activity() const { return *program->instruments[0].activity; }

  void block(uint64_t index) {
    busData.fill(pg::Sample(0.f));
    f.transport.samplePos = kBlock * index;
    f.run(*program, kBlock, &bus);
    // Both voices of the pair, summed, the way `Engine::renderBlock` folds the bus.
    for (const pg::Sample& s : busData) left.push_back(s[0] + s[2]);
  }
  void blocks(uint64_t from, uint64_t to) {
    for (uint64_t b = from; b < to; ++b) block(b);
  }

  /// The last block's loudest sample.
  float peak() const {
    float p = 0.f;
    for (const pg::Sample& s : busData) p = std::max(p, std::fabs(s[0] + s[2]));
    return p;
  }
  /// The largest step between one sample and the next across everything rendered. A wave's own slope
  /// bounds this; a click does not.
  float maxStep() const {
    float m = 0.f;
    for (size_t i = 1; i < left.size(); ++i) m = std::max(m, std::fabs(left[i] - left[i - 1]));
    return m;
  }
};

}  // namespace

// ---------------------------------------------------------------- the rule

TEST_CASE("A voice with nothing to hold it ends with its note, and the next note takes the same voice", "[voices]") {
  Rig rig(false);
  rig.block(0);
  REQUIRE(rig.activity().state(0) == pg::VoiceState::Held);
  REQUIRE(rig.peak() > 0.5f);
  // The note ends at the top of block 1: the voice runs that block as releasing, nothing holds it, and
  // it is on its way out rather than gone -- it has a ramp to play first.
  rig.block(1);
  REQUIRE(rig.activity().state(0) == pg::VoiceState::Releasing);
  // A few blocks and the ramp is over: the voice is back in the pool and the sine is gone with it.
  rig.blocks(2, 6);
  REQUIRE(rig.activity().state(0) == pg::VoiceState::Free);
  rig.block(6);
  REQUIRE(rig.peak() == 0.f);
  // The next cycle's note goes back to voice 0, not to voice 1: one voice for a run of single notes.
  rig.blocks(7, 9);
  REQUIRE(rig.activity().state(0) == pg::VoiceState::Held);
  REQUIRE(rig.activity().state(1) == pg::VoiceState::Free);
}

TEST_CASE("An envelope holds the voice until its release is over", "[voices]") {
  Rig rig(true, 1.f);   // a one-second release: 750 blocks
  rig.block(0);
  rig.block(1);
  REQUIRE(rig.activity().state(0) == pg::VoiceState::Releasing);
  // Well into the release the voice is still there, still audible, and the pair still runs.
  rig.blocks(2, 100);
  REQUIRE(rig.activity().state(0) == pg::VoiceState::Releasing);
  REQUIRE(rig.peak() > 0.f);
  // Once the release has run out the envelope lets go, the ramp runs, and the voice is free.
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
  rig.blocks(2, 6);
  REQUIRE(rig.activity().state(0) == pg::VoiceState::Free);
}

TEST_CASE("The output asked to affect voice lifetime holds a voice for as long as it hears it", "[voices]") {
  Rig rig(false, 1.f, 1.f, /*outLifetime=*/1.f);
  rig.block(0);
  rig.block(1);
  // The sine never falls silent, so the output never lets the voice go: this is the drone, chosen.
  rig.blocks(2, 8);
  REQUIRE(rig.activity().state(0) == pg::VoiceState::Releasing);
  REQUIRE(rig.peak() > 0.5f);
  // And the next note, finding voice 0 busy, takes voice 1.
  rig.block(8);
  REQUIRE(rig.activity().state(0) == pg::VoiceState::Releasing);
  REQUIRE(rig.activity().state(1) == pg::VoiceState::Held);
}

// ---------------------------------------------------------------- the ramp

TEST_CASE("A voice ramps to silence rather than stopping dead", "[voices]") {
  Rig rig(false);
  rig.blocks(0, 7);
  // A sine at this pitch moves by hundredths between samples. Anything near full scale is the wave
  // being cut off, which is the click this ramp exists to remove.
  REQUIRE(rig.maxStep() < 0.1f);
  REQUIRE(rig.left.back() == Catch::Approx(0.f).margin(1e-6f));
}

TEST_CASE("The ramp is committed: a late claim cannot take it back, a new note can", "[voices]") {
  pg::VoiceActivity a(4);
  a.setFadeSamples(128);
  a.noteOn(0);
  a.settle(64);
  REQUIRE(a.state(0) == pg::VoiceState::Held);
  REQUIRE(a.fadeRamp(0, 64).start == 1.f);

  a.noteOff(0);
  a.settle(64);   // nobody held it, so the ramp starts
  REQUIRE(a.state(0) == pg::VoiceState::Releasing);
  // It begins at full gain: the ramp joins what the last block played instead of stepping down to meet it.
  REQUIRE(a.fadeRamp(0, 64).start == 1.f);
  REQUIRE(a.fadeRamp(0, 64).step == Catch::Approx(-0.5f / 64.f));

  // An exit stops hearing a voice *because* it is fading. Letting that claim restart the ramp would put
  // back the click, so a claim on a fading voice is ignored.
  a.hold(0);
  a.settle(64);
  REQUIRE(a.state(0) == pg::VoiceState::Releasing);
  REQUIRE(a.fadeRamp(0, 64).start == Catch::Approx(0.5f));
  a.settle(64);
  REQUIRE(a.state(0) == pg::VoiceState::Free);

  // A note landing on a fading voice does cancel it: the new note plays at full level from its first sample.
  a.noteOn(1);
  a.noteOff(1);
  a.settle(64);
  REQUIRE(a.fadeRamp(1, 64).step < 0.f);
  a.noteOn(1);
  REQUIRE(a.state(1) == pg::VoiceState::Held);
  REQUIRE(a.fadeRamp(1, 64).start == 1.f);
  REQUIRE(a.fadeRamp(1, 64).step == 0.f);
}

// ---------------------------------------------------------------- the patch that started it

TEST_CASE("A run of notes into a sine with no envelope anywhere is free of clicks", "[voices]") {
  // The user's patch, and the regression test for what it sounded like: sixteen notes, four voices, a
  // gap between each note and the next, and nothing but the oscillator between the converter and the
  // output. Every note on and every note off used to be a full-scale step.
  Rig rig(false, 1.f, 1.f, 0.f, "c3 e3 b3 c4", 0.9f, kMusicalTempo);
  rig.blocks(0, 260);   // a cycle: four notes of about 85 ms, with a gap after each
  REQUIRE(rig.maxStep() < 0.1f);
  // And it is a real signal, not a silent one that trivially has no steps in it.
  REQUIRE(*std::max_element(rig.left.begin(), rig.left.end()) > 0.5f);
}

TEST_CASE("Full legato hands over between voices without a click", "[voices]") {
  // At legato 1 the note off and the next note on land on the same frame, so the outgoing voice is still
  // ramping while the new one plays. The two overlap for a moment -- two voices really are sounding, and
  // they sum -- but neither of them steps.
  Rig rig(false, 1.f, 1.f, 0.f, "c3 e3 b3 c4", 1.f, kMusicalTempo);
  rig.blocks(0, 260);
  REQUIRE(rig.maxStep() < 0.1f);
}

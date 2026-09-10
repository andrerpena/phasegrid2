#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <cmath>
#include <map>
#include <string>
#include <vector>
#include "modules/builtin.hpp"
#include "util/Fx.hpp"
#include "util/RtGuard.hpp"

using pg::test::Fx;

namespace {

/// The knob settings a measurement starts from: fully wet, tail only, so what is measured is the tank
/// rather than a blend of it with the dry signal and the early reflections.
constexpr float kSaw = 6.f;
/// The longest reverb time these measurements cover. Past it the window a test would have to
/// integrate over grows faster than a unit test should run; the knob's full hundred-to-one range is
/// measured offline instead, and the numbers are in docs/adrs/0009.
constexpr float kLongest = 5.f;
/// 64-frame blocks: a second and a third of source, then eight seconds of tail. The tail is in the
/// window on purpose -- a decaying reverb excites its own resonances across the spectrum, where a
/// sustained tone only ever sits on the harmonics it happens to have -- and the window is the same
/// length whatever the reverb time, or a longer setting would simply be cut off and read as quieter.
constexpr int kLiveBlocks = 1000;
constexpr int kTailBlocks = 6000;

std::map<std::string, float> tail(float time) {
  return {{"mix", 100.f}, {"late_mix", 100.f}, {"time", time}, {"mod_amount", 0.f}};
}

/// A sawtooth into the reverb, and the whole of what comes back out, one channel at a time.
///
/// Broadband on purpose. A sine through a reverb lands on a peak of one channel's comb structure and
/// in a notch of the other's, so a single tone says nothing about whether the two SIDES are balanced,
/// only about where that tone fell -- which is true of any stereo reverb, and is why the measurements
/// in docs/adrs/0009 are made with a sawtooth too.
struct Burst {
  Fx fx;
  explicit Burst(std::map<std::string, float> params, float transpose = 0.f)
      : fx("fx.reverb", std::move(params), /*sine=*/true, /*level=*/1.f, /*table=*/kSaw, transpose) {}

  /// Runs the source for `kLiveBlocks`, then silences it and runs `kTailBlocks` more, returning the
  /// RMS of one channel over the whole of it.
  double energy(uint32_t lane) {
    double sum = 0;
    int n = 0;
    auto gather = [&](int blocks) {
      for (int b = 0; b < blocks; ++b) {
        fx.f.run(*fx.program, 64);
        for (uint32_t i = 0; i < 64; ++i) {
          const double v = fx.at(i, "out", lane);
          sum += v * v;
          ++n;
        }
      }
    };
    gather(kLiveBlocks);
    fx.muteInput();
    gather(kTailBlocks);
    return std::sqrt(sum / n);
  }
};

double db(double ratio) { return 20.0 * std::log10(ratio); }

/// The pitches a measurement is averaged over, in semitones from middle C.
///
/// One held tone excites only its own harmonics, and those land on peaks of one channel's comb
/// structure and in notches of the other's -- so a single note tells you where that note fell, not
/// what the reverb does. Every number below is the energy of one channel summed over this spread,
/// which is the closest a graph of built-in modules gets to a broadband probe.
constexpr float kPitches[] = {-12.f, -5.f, 0.f, 4.f, 7.f, 11.f};

/// One channel's energy, summed across `kPitches`.
double spectralEnergy(const std::map<std::string, float>& params, uint32_t lane) {
  double total = 0;
  for (float transpose : kPitches) {
    Burst b(params, transpose);
    b.fx.run(20);                       // past the first block's ramps
    const double e = b.energy(lane);
    total += e * e;
  }
  return std::sqrt(total);
}

}  // namespace

TEST_CASE("fx.reverb passes audio and is allocation free", "[reverb][rt]") {
  Fx fx("fx.reverb", {}, /*sine=*/true);
  fx.run(50);
  REQUIRE(fx.rms(100, "src") > 0.5);
  REQUIRE(fx.rms(100) > 0.05);
  pg::test::resetRtViolations();
  { pg::test::RtScope scope; fx.run(100); }
  REQUIRE(pg::test::rtViolations() == 0);
}

TEST_CASE("fx.reverb keeps ringing after its input stops", "[reverb]") {
  Fx fx("fx.reverb", tail(4.f), /*sine=*/true);
  fx.run(100);
  const double wet = fx.rms(50);
  REQUIRE(wet > 0.05);

  fx.muteInput();
  fx.run(2);                       // the dry path is gone within a block; only the tail is left
  REQUIRE(fx.rms(50) > wet / 20);  // still ringing

  // The same graph without a reverb goes silent immediately, so the tail is the reverb's doing.
  Fx bypass("fx.eq", {}, /*sine=*/true);
  bypass.run(100);
  REQUIRE(bypass.rms(50) > 0.05);
  bypass.muteInput();
  bypass.run(2);
  REQUIRE(bypass.rms(50) < 1e-4);
}

TEST_CASE("fx.reverb at Mix 0 passes the dry signal through untouched", "[reverb]") {
  Fx fx("fx.reverb", {{"mix", 0.f}}, /*sine=*/false, 0.5f);
  fx.run(30);   // the mix ramp settles within a block; this is well past it
  for (uint32_t i = 0; i < 64; ++i) REQUIRE(fx.at(i) == Catch::Approx(0.5f).margin(1e-5f));
}

/**
 * The defect this module was written to end: the vendored reverb's wet level rose as the square root
 * of its decay time, so a long tail ran the output into the clipper. Here the tank's input is scaled
 * back by the same law (`kLevelExponent`), and the level is the Mix knob's business rather than the
 * time's.
 *
 * The bound is wider than what a musical source shows. A graph of built-in modules cannot make noise,
 * so the probe is a sawtooth, and as the reverb time grows the network's resonances get taller and
 * NARROWER -- a fixed set of harmonics is less and less likely to sit on one, and the measurement
 * reads a long reverb as quieter than it is. Plucked notes across four pitches, which is transients
 * and so excites everything, hold to under 2 dB over the knob's whole hundred-to-one range; that
 * measurement and its render command are in docs/adrs/0009. What this guards is the regression, and
 * the regression was 18.5 dB.
 */
TEST_CASE("fx.reverb holds its level across the whole reverb time range", "[reverb]") {
  std::vector<double> levels;
  for (float time : {0.316f, 1.26f, kLongest}) levels.push_back(spectralEnergy(tail(time), 0));
  double lo = levels[0], hi = levels[0];
  for (double v : levels) {
    lo = std::min(lo, v);
    hi = std::max(hi, v);
  }
  INFO("levels: " << levels[0] << " " << levels[1] << " " << levels[2]);
  REQUIRE(db(hi / lo) < 4.0);           // it was 18.5 dB across the range on the vendored network
}

/**
 * The other defect: the vendored network's two halves drew different delays and ended up with
 * different energy, so a mono source came out as much as 7.5 dB off centre, always to the same side.
 * This one's halves are mirror images -- the same spread of delays, the same injection, the same tap
 * gains -- so what goes in the middle stays there.
 *
 * Measured across the spectrum, and it has to be. Any stereo reverb answers one held tone with a
 * couple of decibels either way, because that tone falls on a peak of one channel's comb structure
 * and in a notch of the other's; here it scatters around zero rather than leaning, which is the whole
 * difference, and only an average over several pitches can see it.
 */
TEST_CASE("fx.reverb keeps a mono source centred", "[reverb]") {
  for (float time : {0.316f, kLongest}) {
    DYNAMIC_SECTION("time " << time) {
      const double left = spectralEnergy(tail(time), 0);
      const double right = spectralEnergy(tail(time), 1);
      INFO("L " << left << "  R " << right);
      REQUIRE(left > 0.0);
      REQUIRE(std::fabs(db(right / left)) < 1.0);
    }
  }
}

TEST_CASE("fx.reverb's Width collapses the wet image and widens it", "[reverb]") {
  // Width 0 is mono: the two channels of the wet signal are the same sample for sample. The source is
  // mono too, so the dry cannot be what makes them differ -- only the network can.
  Fx narrow("fx.reverb", {{"mix", 100.f}, {"width", 0.f}}, /*sine=*/true);
  narrow.run(120);
  for (int b = 0; b < 10; ++b) {
    narrow.f.run(*narrow.program, 64);
    for (uint32_t i = 0; i < 64; ++i)
      REQUIRE(narrow.at(i, "out", 0) == Catch::Approx(narrow.at(i, "out", 1)).margin(1e-6f));
  }

  // At 150% the two channels differ more than they do at 100%: the side component is scaled up.
  auto sideEnergy = [](float width) {
    Fx fx("fx.reverb", {{"mix", 100.f}, {"width", width}}, /*sine=*/true);
    fx.run(120);
    double sum = 0;
    for (int b = 0; b < 40; ++b) {
      fx.f.run(*fx.program, 64);
      for (uint32_t i = 0; i < 64; ++i) {
        const double side = fx.at(i, "out", 0) - fx.at(i, "out", 1);
        sum += side * side;
      }
    }
    return std::sqrt(sum);
  };
  REQUIRE(sideEnergy(150.f) > sideEnergy(100.f) * 1.2);
}

/**
 * The band factors are what the vendored shelves could not express: theirs only ever ATTENUATED, so a
 * band that rings on after the rest -- which the reference instrument allows to 1.78x -- was
 * unreachable. Measured as the energy left in the tail long after the source has stopped, which is
 * where a longer band shows up.
 */
TEST_CASE("fx.reverb's band factors lengthen and shorten their own band", "[reverb]") {
  auto lateEnergy = [](float lowFactor, float highFactor) {
    auto p = tail(2.f);
    p["low_factor"] = lowFactor;
    p["high_factor"] = highFactor;
    Fx fx("fx.reverb", p, /*sine=*/true);
    fx.run(200);
    fx.muteInput();
    fx.run(120);            // let the first two seconds of tail go by
    return fx.rms(150);     // what is left after it
  };
  const double neutral = lateEnergy(1.f, 1.f);
  REQUIRE(neutral > 0.0);
  REQUIRE(lateEnergy(1.78f, 1.f) > neutral * 1.1);    // the low band rings on
  REQUIRE(lateEnergy(0.562f, 1.f) < neutral * 0.9);   // and can be cut short
}

/**
 * A reverb whose loop gain reaches one never stops. Every band gain is bounded by `bandGains`, so the
 * extreme corner of the surface -- the longest time with both bands asking to ring 1.78 times longer
 * still -- decays rather than runs away.
 */
TEST_CASE("fx.reverb stays stable at the longest time with both bands stretched", "[reverb]") {
  auto p = tail(31.6f);
  p["low_factor"] = 1.78f;
  p["high_factor"] = 1.78f;
  Fx fx("fx.reverb", p, /*sine=*/true);
  fx.run(300);
  const double loud = fx.rms(50);
  fx.muteInput();
  fx.run(2);
  const double first = fx.rms(200);
  const double later = fx.rms(200);
  INFO("while playing " << loud << ", then " << first << " then " << later);
  REQUIRE(later < first);      // still falling, not growing
  REQUIRE(later < loud * 2.0); // and nowhere near running away
}

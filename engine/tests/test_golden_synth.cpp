#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <cmath>
#include <string>
#include <vector>
#include "core/Engine.hpp"
#include "modules/builtin.hpp"
#include "render/OfflineRenderer.hpp"
#include "render/PatchFile.hpp"
#include "util/Fft.hpp"

namespace {

constexpr double kSampleRate = 48000.0;
constexpr uint32_t kChannels = 2;
/// What the patch's `note` node asks for: 0.1 pitch units is one octave above middle C.
constexpr double kExpectedHz = 523.2511;

/// The golden patch, built with a registry that holds ONLY the built-in modules -- the same set the CLI
/// registers, so a patch that loads here is one `--render` can play.
///
/// The chain has no note path in it: its gate and pitch come from `math.scaleOffset` nodes with nothing
/// plugged in (`out = 0 * scale + offset`, i.e. a constant). That is not a preference -- it predates
/// `notes.clip`, which is the first built-in event source -- and it stays that way as the monophonic
/// reference. The note path's own golden render is the polyphonic one, engine/tests/test_golden_poly.cpp.
struct Voice {
  pg::Registry reg;
  pg::Engine engine{reg, pg::EngineConfig{kSampleRate, 64}};

  Voice() {
    pg::registerBuiltinModules(reg);
    const pg::Result loaded = pg::loadPatchFile(std::string(PG_TEST_DIR) + "/golden/synth_voice.json", reg, engine.model());
    INFO(loaded.code << ": " << loaded.message);
    REQUIRE(loaded);
    REQUIRE(engine.commit());
  }
  std::vector<float> render(double seconds) { return pg::renderInterleaved(engine, pg::RenderOptions{seconds, kChannels}); }
};

/// One channel of an interleaved render, from `fromMs` for `frames` frames.
std::vector<float> channelSlice(const std::vector<float>& interleaved, double fromMs, size_t frames, uint32_t channel = 0) {
  const size_t start = static_cast<size_t>(fromMs * kSampleRate / 1000.0);
  REQUIRE((start + frames) * kChannels <= interleaved.size());
  std::vector<float> out(frames);
  for (size_t i = 0; i < frames; ++i) out[i] = interleaved[(start + i) * kChannels + channel];
  return out;
}

float rms(const std::vector<float>& x) {
  double sum = 0.0;
  for (const float v : x) sum += static_cast<double>(v) * v;
  return static_cast<float>(std::sqrt(sum / static_cast<double>(x.size())));
}

/// RMS of a window given in milliseconds, on the left channel.
float rmsMs(const std::vector<float>& interleaved, double fromMs, double toMs) {
  return rms(channelSlice(interleaved, fromMs, static_cast<size_t>((toMs - fromMs) * kSampleRate / 1000.0)));
}

}  // namespace

TEST_CASE("the golden patch renders an audible, pitched, filtered, enveloped voice", "[golden]") {
  Voice voice;
  const std::vector<float> audio = voice.render(1.0);
  REQUIRE(audio.size() == static_cast<size_t>(kSampleRate) * kChannels);

  // 1. It makes a sound at all.
  REQUIRE(rms(channelSlice(audio, 100.0, 32768)) > 0.01f);

  // 2. It is a NOTE, not a drone: the envelope opens the amplifier over the attack and settles at the
  //    sustain level. The patch's attack is 62 ms (0.5 quartic) and its sustain is 0.4 of the peak.
  const float opening = rmsMs(audio, 0.0, 5.0);
  const float peak = rmsMs(audio, 70.0, 110.0);
  const float sustain = rmsMs(audio, 700.0, 1000.0);
  REQUIRE(opening < peak * 0.1f);       // still climbing through the attack
  REQUIRE(sustain < peak * 0.6f);       // decayed to the sustain level
  REQUIRE(sustain > peak * 0.25f);      // and held there rather than released
  REQUIRE(rmsMs(audio, 450.0, 550.0) == Catch::Approx(sustain).epsilon(0.1));   // and stays there

  // 3. It is PITCHED, not noise: the strongest partial in the settled part of the note is the fundamental
  //    the patch asked for. Noise, or an oscillator that never saw the pitch input, fails this.
  const std::vector<float> spectrum = pg::test::magnitudeSpectrum(channelSlice(audio, 500.0, 4096));
  const double binHz = kSampleRate / 4096.0;
  const double peakHz = static_cast<double>(pg::test::peakBin(spectrum)) * binHz;
  INFO("peak at " << peakHz << " Hz, expected " << kExpectedHz);
  REQUIRE(std::fabs(peakHz - kExpectedHz) < 15.0);

  // 4. It is FILTERED: a saw wave is full of high harmonics and the patch's 12 dB low pass sits at MIDI 83
  //    (about 988 Hz), so almost nothing survives three octaves above it.
  const double low = pg::test::bandEnergy(spectrum, kSampleRate, 0.0, 1000.0);
  const double high = pg::test::bandEnergy(spectrum, kSampleRate, 8000.0, kSampleRate / 2);
  REQUIRE(high > 0.0);
  REQUIRE(low / high > 1000.0);

  // 5. Both channels carry it: the oscillator is centred and io.audioOut is fed from one source on both.
  const std::vector<float> left = channelSlice(audio, 500.0, 1024, 0);
  const std::vector<float> right = channelSlice(audio, 500.0, 1024, 1);
  REQUIRE(rms(right) > 0.01f);
  REQUIRE(rms(right) == Catch::Approx(rms(left)).epsilon(0.01));
}

TEST_CASE("the golden patch's brightness really comes from its filter", "[golden]") {
  // Assertion 4 above would also pass on a source that simply had no high harmonics. Opening the cutoff on
  // the SAME running engine and re-measuring separates the two: only a filter that is actually in the
  // signal path changes the spectrum when its knob moves.
  Voice voice;
  const std::vector<float> closed = voice.render(1.0);
  REQUIRE(voice.engine.setParam("filter", "cutoff", 130.f));
  const std::vector<float> open = voice.render(1.0);

  auto highEnergy = [](const std::vector<float>& audio) {
    return pg::test::bandEnergy(pg::test::magnitudeSpectrum(channelSlice(audio, 500.0, 4096)),
                                kSampleRate, 8000.0, kSampleRate / 2);
  };
  REQUIRE(highEnergy(open) > highEnergy(closed) * 100.0);
}

TEST_CASE("the golden patch needs nothing but built-in modules", "[golden]") {
  // `--render` registers built-ins only. A golden patch that reached for a test-only module would render
  // green here and exit 1 from the command line, which is how engine/tests/golden/const_to_out.json behaves.
  pg::Registry reg;
  pg::registerBuiltinModules(reg);
  pg::GraphModel model;
  REQUIRE(pg::loadPatchFile(std::string(PG_TEST_DIR) + "/golden/synth_voice.json", reg, model));
}

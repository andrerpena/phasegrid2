#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <algorithm>
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
/// 341 ms of the settled chord. Long enough that the three fundamentals sit five bins apart at worst, which
/// is what "individually identifiable" needs: a Hann window's main lobe is four bins wide.
constexpr size_t kWindow = 16384;
constexpr double kSettledMs = 700.0;
constexpr double kSeconds = 1.5;

/// The three notes in engine/tests/golden/poly_chord.json: MIDI 60, 64 and 67, a C major triad.
constexpr double kChordHz[3] = {261.6256, 329.6276, 391.9954};
/// Two semitones up: D4, F#4, A4. None of these is one of the three above, nor a low harmonic of one, so
/// transposing the clip has to move every peak and empty every bin it left.
constexpr double kTransposedHz[3] = {293.6648, 369.9944, 440.0000};
/// The two bands BETWEEN the chord's fundamentals. Nothing the patch plays belongs here, so what is left is
/// the skirt of the peaks either side -- which is what makes "peak over valley" a resolution measurement
/// rather than a loudness one.
constexpr double kValleyHz[2][2] = {{275.0, 315.0}, {345.0, 378.0}};

/// The polyphonic golden patch, built with a registry that holds ONLY the built-in modules -- the same set
/// the CLI registers, so this is a patch `--render` can play:
///
///   play (constant 1) -> notes.clip -> note.toPoly -> osc.wavetable -> filter.multi -> amp.vca -> io.audioOut
///                                                  \-> env.adsr   --------------------^
///
/// with the clip's three notes in its node data. Three voices, so two voice pairs: the odd count also leaves
/// one empty lane, which the terminal has to mask away.
struct Chord {
  pg::Registry reg;
  pg::Engine engine{reg, pg::EngineConfig{kSampleRate, 64}};

  Chord() {
    pg::registerBuiltinModules(reg);
    const pg::Result loaded = pg::loadPatchFile(std::string(PG_TEST_DIR) + "/golden/poly_chord.json", reg, engine.model());
    INFO(loaded.code << ": " << loaded.message);
    REQUIRE(loaded);
    REQUIRE(engine.commit());
  }
  std::vector<float> render() { return pg::renderInterleaved(engine, pg::RenderOptions{kSeconds, kChannels}); }
};

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

/// The spectrum of the settled chord on one channel.
std::vector<float> settledSpectrum(const std::vector<float>& audio, uint32_t channel = 0) {
  return pg::test::magnitudeSpectrum(channelSlice(audio, kSettledMs, kWindow, channel));
}

constexpr double kBinHz = kSampleRate / static_cast<double>(kWindow);
size_t binOf(double hz) { return static_cast<size_t>(std::llround(hz / kBinHz)); }

/// The largest bin whose frequency falls in [lowHz, highHz), and where it fell.
std::pair<double, float> bandPeak(const std::vector<float>& spectrum, double lowHz, double highHz) {
  const size_t lo = std::min(binOf(lowHz), spectrum.size() - 1);
  const size_t hi = std::min(binOf(highHz), spectrum.size() - 1);
  size_t best = lo;
  for (size_t k = lo; k <= hi; ++k)
    if (spectrum[k] > spectrum[best]) best = k;
  return {static_cast<double>(best) * kBinHz, spectrum[best]};
}

/// The magnitude at one frequency, taking the largest of the bins its energy can land in.
float magnitudeAt(const std::vector<float>& spectrum, double hz) { return bandPeak(spectrum, hz - 6.0, hz + 6.0).second; }

/// The loudest thing between two of the chord's notes: the noise floor a peak has to stand out of.
float valleyFloor(const std::vector<float>& spectrum) {
  return std::max(bandPeak(spectrum, kValleyHz[0][0], kValleyHz[0][1]).second,
                  bandPeak(spectrum, kValleyHz[1][0], kValleyHz[1][1]).second);
}

}  // namespace

TEST_CASE("the polyphonic golden patch plays three notes at once, each one identifiable", "[golden]") {
  Chord chord;
  const std::vector<float> audio = chord.render();
  REQUIRE(audio.size() == static_cast<size_t>(kSeconds * kSampleRate) * kChannels);

  // 1. It makes a sound at all.
  REQUIRE(rms(channelSlice(audio, kSettledMs, kWindow)) > 0.05f);

  // 2. Three separate peaks, each within a couple of bins of the note the clip holds. A peak that landed on
  //    the wrong frequency, or two notes collapsed onto one voice, fails here.
  const std::vector<float> spectrum = settledSpectrum(audio);
  const float floor = valleyFloor(spectrum);
  REQUIRE(floor > 0.f);
  float level[3] = {0.f, 0.f, 0.f};
  for (int i = 0; i < 3; ++i) {
    const auto [hz, magnitude] = bandPeak(spectrum, kChordHz[i] - 6.0, kChordHz[i] + 6.0);
    INFO("note " << i << ": peak at " << hz << " Hz, expected " << kChordHz[i] << ", magnitude " << magnitude
                 << " against a floor of " << floor);
    REQUIRE(std::fabs(hz - kChordHz[i]) < 3.0);
    // 3. And each one is RESOLVED, not a shoulder of its neighbour: the bands between the notes, where the
    //    patch plays nothing, are two orders of magnitude down on every peak.
    REQUIRE(magnitude > floor * 100.f);
    level[i] = magnitude;
  }

  // 4. All three are really sounding, rather than one note dominating and two hiding in its skirt.
  const float loudest = std::max({level[0], level[1], level[2]});
  const float quietest = std::min({level[0], level[1], level[2]});
  REQUIRE(quietest > loudest * 0.5f);

  // 5. Both channels carry the chord: the oscillator is centred and io.audioOut is fed from one source.
  REQUIRE(rms(channelSlice(audio, kSettledMs, 1024, 1)) == Catch::Approx(rms(channelSlice(audio, kSettledMs, 1024, 0))).epsilon(0.01));
}

TEST_CASE("the polyphonic golden patch's three peaks are the clip's own notes", "[golden]") {
  // Three peaks in the right places would also appear if something other than the clip were choosing the
  // pitches. Transposing the clip two semitones on the SAME running engine separates the two: every peak has
  // to move to the new note and every bin it left has to empty. A rendered chord that ignored the clip, or a
  // transpose that only reached the note ons and not the sounding notes, fails one half or the other.
  Chord chord;
  const std::vector<float> spectrum = settledSpectrum(chord.render());
  REQUIRE(chord.engine.setParam("clip", "transpose", 2.f));
  const std::vector<float> moved = settledSpectrum(chord.render());

  const float floor = valleyFloor(spectrum);
  for (int i = 0; i < 3; ++i) {
    INFO("note " << i << ": " << kChordHz[i] << " Hz -> " << kTransposedHz[i] << " Hz");
    REQUIRE(magnitudeAt(moved, kTransposedHz[i]) > floor * 100.f);            // the new note is playing
    REQUIRE(magnitudeAt(spectrum, kChordHz[i]) > magnitudeAt(moved, kChordHz[i]) * 100.f);   // the old one is not
  }
}

TEST_CASE("the polyphonic golden patch's three peaks need three voices", "[golden]") {
  // The other half of the same question: three peaks could come from one oscillator with a rich enough
  // spectrum. Dropping the program to a single voice on the same engine leaves the three notes fighting over
  // it, so only the last one to steal it survives -- and the other two peaks have to vanish.
  Chord chord;
  const std::vector<float> three = settledSpectrum(chord.render());
  REQUIRE(chord.engine.setParam("poly", "voices", 1.f));   // structural: the next commit rebuilds the instrument
  REQUIRE(chord.engine.commit());
  const std::vector<float> one = settledSpectrum(chord.render());

  REQUIRE(magnitudeAt(one, kChordHz[2]) > valleyFloor(three) * 100.f);        // G4 took the only voice
  REQUIRE(magnitudeAt(three, kChordHz[0]) > magnitudeAt(one, kChordHz[0]) * 100.f);
  REQUIRE(magnitudeAt(three, kChordHz[1]) > magnitudeAt(one, kChordHz[1]) * 100.f);
}

TEST_CASE("the polyphonic golden patch needs nothing but built-in modules", "[golden]") {
  // `--render` registers built-ins only, so a golden patch that reached for a test-only module would render
  // green here and exit 1 from the command line.
  pg::Registry reg;
  pg::registerBuiltinModules(reg);
  pg::GraphModel model;
  REQUIRE(pg::loadPatchFile(std::string(PG_TEST_DIR) + "/golden/poly_chord.json", reg, model));
  REQUIRE(model.nodes().at("clip").data["notes"].size() == 3);   // and the clip's notes survived the load
}

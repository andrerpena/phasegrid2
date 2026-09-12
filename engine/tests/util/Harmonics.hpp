#pragma once
#include <catch2/catch_test_macros.hpp>
#include <cmath>
#include <cstdint>
#include <vector>
#include "util/Fft.hpp"

/**
 * Measuring a waveform by its harmonic series.
 *
 * A waveform is its spectrum: sine, triangle, square and saw differ only in which harmonics they carry
 * and how fast those fall off. So a test of a waveform asks for the amplitude of each harmonic as a
 * fraction of the fundamental and compares that with theory.
 *
 * The fundamental is placed exactly on an FFT bin. At a musically tidy pitch it sits between bins and
 * its leakage skirt biases every harmonic by five to ten percent in alternating directions, which forces
 * tolerances wide enough for a genuinely wrong shape to pass.
 */
namespace pg::test {

constexpr size_t kHarmonicWindow = 16384;
constexpr float kMiddleCHzForTests = 261.6256f;

/// A fundamental that lands on FFT bin `bin` of a `kHarmonicWindow` window at `sampleRate`.
struct OnBin {
  size_t bin;
  double hz;
  /// The pitch-input value (0.1 per octave from middle C) that plays it.
  float pitch;
};

inline OnBin onBin(size_t bin, double sampleRate) {
  const double hz = static_cast<double>(bin) * sampleRate / static_cast<double>(kHarmonicWindow);
  return OnBin{bin, hz, std::log2(static_cast<float>(hz) / kMiddleCHzForTests) / 10.f};
}

/// One channel of an interleaved render, `kHarmonicWindow` frames from `startSeconds` in.
inline std::vector<float> analysisWindow(const std::vector<float>& interleaved, double sampleRate,
                                         double startSeconds, uint32_t channels = 2, uint32_t channel = 0) {
  const size_t start = static_cast<size_t>(startSeconds * sampleRate);
  REQUIRE((start + kHarmonicWindow) * channels <= interleaved.size());
  std::vector<float> out(kHarmonicWindow);
  for (size_t i = 0; i < kHarmonicWindow; ++i) out[i] = interleaved[(start + i) * channels + channel];
  return out;
}

/// Amplitude of the n-th harmonic of a fundamental on `bin`. A Hann window spreads a bin-centred sinusoid
/// over exactly three bins, so the three are combined rather than the peak taken.
inline float harmonicAmplitude(const std::vector<float>& mag, size_t bin, int n) {
  const size_t centre = bin * static_cast<size_t>(n);
  if (centre + 1 >= mag.size()) return 0.f;
  double sum = 0.0;
  for (size_t k = centre - 1; k <= centre + 1; ++k) sum += static_cast<double>(mag[k]) * mag[k];
  return static_cast<float>(std::sqrt(sum));
}

/// Every harmonic from 2 up, as a fraction of the fundamental.
struct HarmonicSeries {
  float h1 = 0.f;
  std::vector<float> ratio{0.f, 1.f};   // index n holds harmonic n; index 0 unused
  float operator[](int n) const { return static_cast<size_t>(n) < ratio.size() ? ratio[static_cast<size_t>(n)] : 0.f; }
};

inline HarmonicSeries harmonicSeries(const std::vector<float>& window, size_t bin, int upTo = 9) {
  const std::vector<float> mag = magnitudeSpectrum(window);
  HarmonicSeries s;
  s.h1 = harmonicAmplitude(mag, bin, 1);
  REQUIRE(s.h1 > 1.f);   // there is a tone at all: every ratio below divides by this
  for (int n = 2; n <= upTo; ++n) s.ratio.push_back(harmonicAmplitude(mag, bin, n) / s.h1);
  return s;
}

}  // namespace pg::test

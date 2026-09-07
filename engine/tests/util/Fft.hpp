#pragma once
#include <cassert>
#include <cmath>
#include <complex>
#include <cstdint>
#include <vector>

namespace pg::test {

/// Magnitude spectrum of a real signal: an iterative radix-2 FFT, small enough to read and slow enough not
/// to matter for the block sizes a test measures. `samples.size()` must be a power of two; the result holds
/// the first N/2 + 1 bins, bin k being frequency `k * sampleRate / N`.
///
/// A Hann window is applied first. Without it the fundamental of a note that does not fit a whole number of
/// periods into the window smears across neighbouring bins, which is exactly the case a spectral assertion
/// about a musical pitch runs into.
inline std::vector<float> magnitudeSpectrum(const std::vector<float>& samples) {
  const size_t n = samples.size();
  assert(n >= 2 && (n & (n - 1)) == 0);

  std::vector<std::complex<double>> a(n);
  for (size_t i = 0; i < n; ++i) {
    const double window = 0.5 - 0.5 * std::cos(2.0 * M_PI * static_cast<double>(i) / static_cast<double>(n - 1));
    a[i] = std::complex<double>(samples[i] * window, 0.0);
  }

  // Bit-reversal permutation, then log2(n) butterfly passes.
  for (size_t i = 1, j = 0; i < n; ++i) {
    size_t bit = n >> 1;
    for (; (j & bit) != 0; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) std::swap(a[i], a[j]);
  }
  for (size_t len = 2; len <= n; len <<= 1) {
    const double angle = -2.0 * M_PI / static_cast<double>(len);
    const std::complex<double> step(std::cos(angle), std::sin(angle));
    for (size_t i = 0; i < n; i += len) {
      std::complex<double> w(1.0, 0.0);
      for (size_t k = 0; k < len / 2; ++k) {
        const std::complex<double> u = a[i + k];
        const std::complex<double> v = a[i + k + len / 2] * w;
        a[i + k] = u + v;
        a[i + k + len / 2] = u - v;
        w *= step;
      }
    }
  }

  std::vector<float> magnitudes(n / 2 + 1);
  for (size_t k = 0; k < magnitudes.size(); ++k) magnitudes[k] = static_cast<float>(std::abs(a[k]));
  return magnitudes;
}

/// Index of the largest bin, ignoring DC and the first bin above it (a window's own leakage skirt).
inline size_t peakBin(const std::vector<float>& magnitudes) {
  size_t best = 2;
  for (size_t k = 2; k < magnitudes.size(); ++k)
    if (magnitudes[k] > magnitudes[best]) best = k;
  return best;
}

/// Summed power of every bin whose frequency falls in [lowHz, highHz).
inline double bandEnergy(const std::vector<float>& magnitudes, double sampleRate, double lowHz, double highHz) {
  const size_t n = (magnitudes.size() - 1) * 2;
  double total = 0.0;
  for (size_t k = 0; k < magnitudes.size(); ++k) {
    const double hz = static_cast<double>(k) * sampleRate / static_cast<double>(n);
    if (hz >= lowHz && hz < highHz) total += static_cast<double>(magnitudes[k]) * magnitudes[k];
  }
  return total;
}

}  // namespace pg::test

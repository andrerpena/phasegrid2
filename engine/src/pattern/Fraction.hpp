#pragma once
/*
 * Rational time, ported from Strudel's use of fraction.js.
 *
 * Ported from TidalCycles (Alex McLean) by way of Strudel
 * <https://codeberg.org/uzu/strudel>, AGPL-3.0-or-later, the same licence as this project.
 * `packages/core/fraction.mjs` is the original.
 *
 * Time in a pattern is rational and NOT floating point, and that is not a stylistic choice. A
 * hap sounds when its whole begins exactly where its part does, and a cycle boundary is an
 * equality, not a neighbourhood: `1/3 * 3` has to be exactly 1 or `"c*3"` inside `.fast(7)`
 * intermittently drops an onset and emits a fragment nobody asked for. Weights divide by
 * arbitrary sums, and nesting multiplies denominators, so the errors compound rather than cancel.
 */
#include <cstdint>
#include <numeric>

namespace pg::pattern {

/// A rational, always normalised, always with a positive denominator.
///
/// `int64` numerator and denominator are far more than mini-notation needs: the denominators
/// come from step counts and weight sums, and even a deeply nested polymeter lands in the low
/// thousands. Overflow would need a pattern no one could read.
struct Fraction {
  int64_t n = 0;
  int64_t d = 1;

  constexpr Fraction() = default;
  constexpr Fraction(int64_t num) : n(num), d(1) {}
  constexpr Fraction(int64_t num, int64_t den) : n(num), d(den) { normalise(); }

  constexpr void normalise() {
    if (d == 0) { n = 0; d = 1; return; }       // a caller's division by zero, made harmless
    if (d < 0) { n = -n; d = -d; }
    const int64_t g = std::gcd(n < 0 ? -n : n, d);
    if (g > 1) { n /= g; d /= g; }
    if (n == 0) d = 1;
  }

  constexpr Fraction operator+(const Fraction& o) const { return {n * o.d + o.n * d, d * o.d}; }
  constexpr Fraction operator-(const Fraction& o) const { return {n * o.d - o.n * d, d * o.d}; }
  constexpr Fraction operator*(const Fraction& o) const { return {n * o.n, d * o.d}; }
  constexpr Fraction operator/(const Fraction& o) const { return {n * o.d, d * o.n}; }
  constexpr Fraction operator-() const { Fraction r; r.n = -n; r.d = d; return r; }

  constexpr bool operator==(const Fraction& o) const { return n == o.n && d == o.d; }
  constexpr bool operator!=(const Fraction& o) const { return !(*this == o); }
  constexpr bool operator<(const Fraction& o) const { return n * o.d < o.n * d; }
  constexpr bool operator<=(const Fraction& o) const { return n * o.d <= o.n * d; }
  constexpr bool operator>(const Fraction& o) const { return o < *this; }
  constexpr bool operator>=(const Fraction& o) const { return o <= *this; }

  constexpr bool isZero() const { return n == 0; }
  double toDouble() const { return static_cast<double>(n) / static_cast<double>(d); }

  /// Floor. Named for Tidal's "start of the cycle this time is in".
  constexpr Fraction sam() const {
    int64_t q = n / d;
    if (n % d != 0 && n < 0) --q;                // C++ truncates towards zero; a floor does not
    return Fraction(q);
  }
  constexpr Fraction nextSam() const { return sam() + Fraction(1); }
  /// Where in its cycle this time is: 0 <= cyclePos < 1.
  constexpr Fraction cyclePos() const { return *this - sam(); }

  constexpr Fraction min(const Fraction& o) const { return *this < o ? *this : o; }
  constexpr Fraction max(const Fraction& o) const { return *this < o ? o : *this; }
};

}  // namespace pg::pattern

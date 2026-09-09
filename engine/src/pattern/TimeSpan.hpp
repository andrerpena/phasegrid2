#pragma once
/*
 * A stretch of cycle time, and a hap: one event the pattern query answers with.
 *
 * Ported from TidalCycles (Alex McLean) by way of Strudel
 * <https://codeberg.org/uzu/strudel>, AGPL-3.0-or-later, the same licence as this project.
 * `packages/core/timespan.mjs` and `packages/core/hap.mjs` are the originals.
 */
#include <cstdint>
#include "pattern/Fraction.hpp"

namespace pg::pattern {

struct TimeSpan {
  Fraction begin;
  Fraction end;

  constexpr TimeSpan() = default;
  constexpr TimeSpan(Fraction b, Fraction e) : begin(b), end(e) {}

  constexpr Fraction duration() const { return end - begin; }
  Fraction midpoint() const { return begin + duration() / Fraction(2); }
  constexpr bool operator==(const TimeSpan& o) const { return begin == o.begin && end == o.end; }

  /// The overlap of two spans, or nothing. A zero-width span survives only where it touches the
  /// other span's interior or its start, which is what keeps an instantaneous query addressable
  /// rather than silently empty.
  constexpr bool intersect(const TimeSpan& o, TimeSpan& out) const {
    const Fraction b = begin.max(o.begin);
    const Fraction e = end.min(o.end);
    if (b > e) return false;
    if (b == e) {
      // Zero width: only meaningful at the start of one of the two spans.
      if (b == end && begin < end) return false;
      if (b == o.end && o.begin < o.end) return false;
    }
    out = TimeSpan(b, e);
    return true;
  }
};

/// One event: `part` is the piece of it this query is looking at, `whole` the whole of it.
///
/// A hap with no whole is a sample of a continuous signal (`rand`), which mini-notation only ever
/// produces internally -- everything that reaches a module is discrete.
struct Hap {
  TimeSpan whole;
  TimeSpan part;
  bool hasWhole = false;
  /// Which atom of the parse this came from, or -1. It is what lets the editor outline the step
  /// that is sounding: the atom carries its own character range in the pattern string.
  int32_t atom = -1;
  float value = 0.f;
  /// The `:` tail, or NaN. Free of meaning here; a module decides what a second number means.
  float tail = 0.f;
  bool hasTail = false;

  const TimeSpan& wholeOrPart() const { return hasWhole ? whole : part; }
  /// True when this piece is the START of the event. The scheduler's trigger test, and the reason
  /// wholes are rational: it is an equality.
  bool hasOnset() const { return hasWhole && whole.begin == part.begin; }
};

}  // namespace pg::pattern

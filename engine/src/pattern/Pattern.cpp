/*
 * The pattern query. See `Pattern.hpp` for why it is a tree walk rather than a closure graph.
 *
 * Ported from TidalCycles (Alex McLean) by way of Strudel's `packages/core/pattern.mjs`,
 * `signal.mjs` and `euclid.mjs` <https://codeberg.org/uzu/strudel>, AGPL-3.0-or-later.
 *
 * Almost every combinator here is "query the child, then move what it said": speeding a pattern
 * up multiplies query time and divides event time, shifting it does the same with addition. So
 * the child is queried STRAIGHT INTO THE ANSWER and its events are then rewritten where they
 * lie. That is what keeps the query allocation-free without a scratch buffer at every level --
 * only the handful of combinators that take an argument pattern (`c*<2 3>`, `c(<3 5>,8)`) need
 * somewhere to put it, and an argument pattern is a few events wide by construction.
 */
#include "pattern/Pattern.hpp"

#include <cmath>

namespace pg::pattern {
namespace {

/// Decorrelates one random operator in a string from the next. Strudel's `randOffset`.
constexpr double kRandOffset = 0.0003;

/// Events an argument pattern may have in one cycle. `<2 3>` has one; `8` has one. A pattern
/// that wants more than this as a *factor* is refused rather than half-read.
constexpr uint32_t kMaxArgHaps = 8;

/// A decimal from an atom as an exact rational, the same way the parser reads one.
Fraction fractionOf(double v) {
  return Fraction(static_cast<int64_t>(std::llround(v * 1000.0)), 1000);
}

/// Where the answers go, and how much room is left for them.
struct Query {
  const Program& p;
  Hap* out;
  uint32_t capacity;
  uint32_t count = 0;
  bool overflowed = false;

  bool push(const Hap& h) {
    if (count == capacity) { overflowed = true; return false; }
    out[count++] = h;
    return true;
  }
};

/// Splits a span at cycle boundaries. `TimeSpan::spanCycles` -- the reason most combinators may
/// assume a query never straddles a cycle.
///
/// A zero-width span is one subspan, not none: an instantaneous query still has to be answerable.
template <class Fn>
void forEachCycle(const TimeSpan& span, Fn&& fn) {
  if (span.begin > span.end) return;
  if (span.begin == span.end) { fn(span); return; }
  Fraction begin = span.begin;
  while (span.end > begin) {
    if (begin.sam() == span.end.sam()) { fn(TimeSpan(begin, span.end)); return; }
    const Fraction next = begin.nextSam();
    fn(TimeSpan(begin, next));
    begin = next;
  }
}

void queryNode(Query& q, uint32_t node, const TimeSpan& span);

/// Moves every event `queryNode` just appended, by `move(whole, part)`.
template <class Fn>
void rewrite(Query& q, uint32_t mark, Fn&& move) {
  for (uint32_t i = mark; i < q.count; ++i) {
    Hap& h = q.out[i];
    move(h);
  }
}

/// The events of an argument pattern over one span. Argument patterns are factors and step
/// counts, so this is deliberately a small fixed array rather than more machinery.
struct Args {
  Hap haps[kMaxArgHaps];
  uint32_t count = 0;
};

bool queryArgs(const Program& p, uint32_t node, const TimeSpan& span, Args& args) {
  Query sub{p, args.haps, kMaxArgHaps};
  queryNode(sub, node, span);
  args.count = sub.count;
  return !sub.overflowed;
}

/// The one value an argument pattern has over a span.
bool argValue(const Program& p, uint32_t node, const TimeSpan& span, double& out) {
  Args args;
  if (!queryArgs(p, node, span, args) || args.count == 0) return false;
  out = static_cast<double>(args.haps[0].value);
  return true;
}

/// `pure`: one event per cycle, filling it.
void queryPure(Query& q, const Node& n, const TimeSpan& span) {
  const Atom& atom = q.p.atoms[static_cast<size_t>(n.atom)];
  forEachCycle(span, [&](const TimeSpan& sub) {
    Hap h;
    h.whole = TimeSpan(sub.begin.sam(), sub.begin.nextSam());
    h.hasWhole = true;
    h.part = sub;
    h.value = atom.value;
    h.atom = n.atom;
    q.push(h);
  });
}

/// `slowcat`: one child per cycle, in turn.
///
/// The offset is what stops the constituent patterns from having their own cycles skipped: the
/// fourth cycle of three stacked patterns is the SECOND cycle of the first pattern, not the
/// fourth. It is the subtlest line in the whole port.
void querySlowCat(Query& q, const Node& n, const TimeSpan& span) {
  const int64_t count = static_cast<int64_t>(n.childCount);
  forEachCycle(span, [&](const TimeSpan& sub) {
    const Fraction cycle = sub.begin.sam();
    int64_t index = cycle.n % count;
    if (index < 0) index += count;
    const Fraction offset = cycle - (cycle / Fraction(count)).sam();
    const uint32_t mark = q.count;
    queryNode(q, q.p.children[n.firstChild + static_cast<uint32_t>(index)],
              TimeSpan(sub.begin - offset, sub.end - offset));
    rewrite(q, mark, [&](Hap& h) {
      h.whole = TimeSpan(h.whole.begin + offset, h.whole.end + offset);
      h.part = TimeSpan(h.part.begin + offset, h.part.end + offset);
    });
  });
}

/// `fast`: query time multiplied, event time divided.
void queryFast(Query& q, const Node& n, const TimeSpan& span) {
  const Fraction f = n.factor;
  const uint32_t mark = q.count;
  queryNode(q, n.argA, TimeSpan(span.begin * f, span.end * f));
  rewrite(q, mark, [&](Hap& h) {
    h.whole = TimeSpan(h.whole.begin / f, h.whole.end / f);
    h.part = TimeSpan(h.part.begin / f, h.part.end / f);
  });
}

/// `late`: the child, shifted.
void queryLate(Query& q, const Node& n, const TimeSpan& span) {
  const Fraction a = n.factor;
  const uint32_t mark = q.count;
  queryNode(q, n.argA, TimeSpan(span.begin - a, span.end - a));
  rewrite(q, mark, [&](Hap& h) {
    h.whole = TimeSpan(h.whole.begin + a, h.whole.end + a);
    h.part = TimeSpan(h.part.begin + a, h.part.end + a);
  });
}

/// `fastGap`: the child squeezed into the head of each cycle, the rest left empty.
///
/// The fiddliest function in the port, and it is ported literally. The query position is clamped
/// at the end of the cycle so a zero-width query at the start of the next one is dropped, and an
/// event's `whole` is rebuilt relative to its `part` rather than scaled with it -- which is what
/// keeps a note that began before the gap from claiming an onset inside it.
void queryFastGap(Query& q, const Node& n, const TimeSpan& span) {
  const Fraction f = n.factor;
  if (f <= Fraction(0)) return;
  forEachCycle(span, [&](const TimeSpan& sub) {
    const Fraction cycle = sub.begin.sam();
    const Fraction bpos = ((sub.begin - cycle) * f).min(Fraction(1));
    const Fraction epos = ((sub.end - cycle) * f).min(Fraction(1));
    if (bpos >= Fraction(1)) return;
    const uint32_t mark = q.count;
    queryNode(q, n.argA, TimeSpan(cycle + bpos, cycle + epos));
    rewrite(q, mark, [&](Hap& h) {
      const Fraction begin = h.part.begin;
      const Fraction end = h.part.end;
      const Fraction c = begin.sam();
      const TimeSpan part(c + ((begin - c) / f).min(Fraction(1)),
                          c + ((end - c) / f).min(Fraction(1)));
      if (h.hasWhole)
        h.whole = TimeSpan(part.begin - (begin - h.whole.begin) / f,
                           part.end + (h.whole.end - end) / f);
      h.part = part;
    });
  });
}

/// `repeatCycles`: each of the child's cycles held for `n` of ours. What makes `a!3` differ from
/// `a*3` -- the source cycle repeats rather than running three times.
void queryRepeatCycles(Query& q, const Node& n, const TimeSpan& span) {
  const Fraction count = n.factor;
  if (count <= Fraction(0)) return;
  forEachCycle(span, [&](const TimeSpan& sub) {
    const Fraction cycle = sub.begin.sam();
    const Fraction delta = cycle - (cycle / count).sam();
    const uint32_t mark = q.count;
    queryNode(q, n.argA, TimeSpan(sub.begin - delta, sub.end - delta));
    rewrite(q, mark, [&](Hap& h) {
      h.whole = TimeSpan(h.whole.begin + delta, h.whole.end + delta);
      h.part = TimeSpan(h.part.begin + delta, h.part.end + delta);
    });
  });
}

/// `?`: drops an event when its draw falls below the threshold.
///
/// The draw is taken at the start of the event's whole, shifted by the operator's own seed, so
/// two `?`s in one string are independent and the same string degrades the same way every run.
void queryDegrade(Query& q, const Node& n, const TimeSpan& span) {
  const double amount = n.factor.toDouble();
  const double offset = kRandOffset * static_cast<double>(n.seed);
  const uint32_t mark = q.count;
  queryNode(q, n.argA, span);
  uint32_t keep = mark;
  for (uint32_t i = mark; i < q.count; ++i) {
    if (randAt(q.out[i].wholeOrPart().begin.toDouble() + offset) <= amount) continue;
    q.out[keep++] = q.out[i];
  }
  q.count = keep;
}

/// `|`: one child per cycle, drawn at random.
void queryChoose(Query& q, const Node& n, const TimeSpan& span) {
  const double offset = kRandOffset * static_cast<double>(n.seed);
  forEachCycle(span, [&](const TimeSpan& sub) {
    const double r = randAt(sub.begin.sam().toDouble() + offset);
    const int32_t last = static_cast<int32_t>(n.childCount) - 1;
    int32_t index = static_cast<int32_t>(std::floor(r * static_cast<double>(n.childCount)));
    if (index < 0) index = 0;
    if (index > last) index = last;
    queryNode(q, q.p.children[n.firstChild + static_cast<uint32_t>(index)], sub);
  });
}

/// `*` and `/` where the factor is itself a pattern: `c*<2 3>`. Structure comes from the inner
/// pattern, so a factor that changes mid-cycle splits the cycle rather than restarting it.
void queryInnerFast(Query& q, const Node& n, const TimeSpan& span, bool slow) {
  forEachCycle(span, [&](const TimeSpan& sub) {
    Args args;
    if (!queryArgs(q.p, n.argB, sub, args)) { q.overflowed = true; return; }
    for (uint32_t a = 0; a < args.count; ++a) {
      const Fraction v = fractionOf(static_cast<double>(args.haps[a].value));
      if (v.isZero()) continue;
      const Fraction f = slow ? n.factor / v : v * n.factor;
      if (f.isZero()) continue;
      const TimeSpan inner = args.haps[a].part;
      const uint32_t mark = q.count;
      queryNode(q, n.argA, TimeSpan(inner.begin * f, inner.end * f));
      rewrite(q, mark, [&](Hap& h) {
        h.whole = TimeSpan(h.whole.begin / f, h.whole.end / f);
        h.part = TimeSpan(h.part.begin / f, h.part.end / f);
      });
    }
  });
}

/// `(p,s,r)`: the child's values against a euclidean rhythm.
///
/// This is `struct`: the rhythm decides WHEN events happen and the child only says what they
/// are, which is why the event's whole is the slot and not whatever the child had.
void queryEuclid(Query& q, const Node& n, const TimeSpan& span) {
  forEachCycle(span, [&](const TimeSpan& sub) {
    double pulses = 0.0, steps = 0.0, rotation = 0.0;
    if (!argValue(q.p, n.argB, sub, pulses)) return;
    if (!argValue(q.p, n.argC, sub, steps)) return;
    if (n.hasArgD && !argValue(q.p, n.argD, sub, rotation)) return;
    const int32_t stepCount = static_cast<int32_t>(std::llround(steps));
    uint8_t rhythm[kMaxEuclidSteps];
    if (!bjorklund(static_cast<int32_t>(std::llround(pulses)), stepCount,
                   static_cast<int32_t>(std::llround(rotation)), rhythm))
      return;
    const Fraction cycle = sub.begin.sam();
    const Fraction width(1, stepCount);
    for (int32_t i = 0; i < stepCount; ++i) {
      if (rhythm[i] == 0) continue;
      const TimeSpan slot(cycle + width * Fraction(i), cycle + width * Fraction(i + 1));
      TimeSpan part;
      if (!slot.intersect(sub, part)) continue;
      const uint32_t mark = q.count;
      queryNode(q, n.argA, part);
      uint32_t keep = mark;
      for (uint32_t k = mark; k < q.count; ++k) {
        Hap h = q.out[k];
        TimeSpan clipped;
        if (!h.part.intersect(part, clipped)) continue;
        h.whole = slot;
        h.hasWhole = true;
        h.part = clipped;
        q.out[keep++] = h;
      }
      q.count = keep;
    }
  });
}

/// `:`: a second number carried next to the value, aligned to the value's own structure.
///
/// Where the argument changes under a single event Strudel splits it into fragments, of which
/// only the first carries the onset. Only the onset can start a note, so the first is the one
/// kept and the event stays whole -- which also keeps this a rewrite in place.
void queryTail(Query& q, const Node& n, const TimeSpan& span) {
  const uint32_t mark = q.count;
  queryNode(q, n.argA, span);
  uint32_t keep = mark;
  for (uint32_t i = mark; i < q.count; ++i) {
    const Hap left = q.out[i];
    Args args;
    if (!queryArgs(q.p, n.argB, left.wholeOrPart(), args)) { q.overflowed = true; break; }
    for (uint32_t a = 0; a < args.count; ++a) {
      Hap h = left;
      if (!left.part.intersect(args.haps[a].part, h.part)) continue;
      h.tail = args.haps[a].value;
      h.hasTail = true;
      q.out[keep++] = h;
      break;
    }
  }
  q.count = keep;
}

/// `..`: the run of integers between two values, laid across each step of the left pattern.
///
/// The left pattern's events are read out of the answer and then overwritten by the runs they
/// expand into, so each run is built PAST them and the whole lot is moved back down at the end.
void queryRange(Query& q, const Node& n, const TimeSpan& span) {
  const uint32_t mark = q.count;
  queryNode(q, n.argA, span);
  const uint32_t end = q.count;
  bool full = false;
  for (uint32_t i = mark; i < end && !full; ++i) {
    const Hap a = q.out[i];
    if (!a.hasWhole) continue;
    double to = 0.0;
    if (!argValue(q.p, n.argB, a.wholeOrPart(), to)) continue;
    const int32_t from = static_cast<int32_t>(std::llround(static_cast<double>(a.value)));
    const int32_t last = static_cast<int32_t>(std::llround(to));
    const int32_t step = last < from ? -1 : 1;
    const int64_t length = static_cast<int64_t>(last > from ? last - from : from - last) + 1;
    const TimeSpan host = a.wholeOrPart();
    const Fraction width = host.duration() / Fraction(length);
    if (width.isZero()) continue;
    for (int64_t k = 0; k < length; ++k) {
      Hap h;
      h.whole = TimeSpan(host.begin + width * Fraction(k), host.begin + width * Fraction(k + 1));
      h.hasWhole = true;
      if (!h.whole.intersect(a.part, h.part)) continue;
      h.value = static_cast<float>(from + step * static_cast<int32_t>(k));
      h.atom = a.atom;
      if (!q.push(h)) { full = true; break; }
    }
  }
  const uint32_t written = q.count - end;
  for (uint32_t i = 0; i < written; ++i) q.out[mark + i] = q.out[end + i];
  q.count = mark + written;
}

void queryNode(Query& q, uint32_t node, const TimeSpan& span) {
  if (node >= q.p.nodes.size()) return;
  const Node& n = q.p.nodes[node];
  switch (n.kind) {
    case NodeKind::Silence: return;
    case NodeKind::Pure: return queryPure(q, n, span);
    case NodeKind::Stack:
      for (uint32_t i = 0; i < n.childCount; ++i) queryNode(q, q.p.children[n.firstChild + i], span);
      return;
    case NodeKind::SlowCat: return querySlowCat(q, n, span);
    case NodeKind::Fast: return queryFast(q, n, span);
    case NodeKind::FastGap: return queryFastGap(q, n, span);
    case NodeKind::Late: return queryLate(q, n, span);
    case NodeKind::RepeatCycles: return queryRepeatCycles(q, n, span);
    case NodeKind::Degrade: return queryDegrade(q, n, span);
    case NodeKind::Choose: return queryChoose(q, n, span);
    case NodeKind::InnerFast: return queryInnerFast(q, n, span, false);
    case NodeKind::InnerSlow: return queryInnerFast(q, n, span, true);
    case NodeKind::Euclid: return queryEuclid(q, n, span);
    case NodeKind::Tail: return queryTail(q, n, span);
    case NodeKind::Range: return queryRange(q, n, span);
  }
}

}  // namespace

double randAt(double t) {
  // JavaScript's bitwise operators are defined on int32 with wraparound, so the port has to be
  // too: this is a hash, and a different overflow rule is a different pattern of holes.
  const auto xorwise = [](int32_t x) -> int32_t {
    const int32_t a = static_cast<int32_t>(static_cast<uint32_t>(x) << 13) ^ x;
    const int32_t b = (a >> 17) ^ a;
    return static_cast<int32_t>(static_cast<uint32_t>(b) << 5) ^ b;
  };
  const double scaled = t / 300.0;
  const double frac = scaled - std::trunc(scaled);
  const int32_t seed = xorwise(static_cast<int32_t>(std::trunc(frac * 536870912.0)));
  return std::fabs(static_cast<double>(seed % 536870912) / 536870912.0);
}

bool bjorklund(int32_t pulses, int32_t steps, int32_t rotation, uint8_t* out) {
  if (steps <= 0 || steps > static_cast<int32_t>(kMaxEuclidSteps)) return false;
  const bool inverted = pulses < 0;
  int32_t ons = pulses < 0 ? -pulses : pulses;
  if (ons > steps) ons = steps;
  int32_t offs = steps - ons;

  // Bjorklund's algorithm, in the shape Rohan Drape's Haskell has it (by way of Strudel's
  // `euclid.mjs`): two lists of bit groups, folded into each other until one side is down to a
  // single group. Fixed storage rather than lists, so it is safe on the audio thread.
  uint8_t xs[kMaxEuclidSteps][kMaxEuclidSteps], ys[kMaxEuclidSteps][kMaxEuclidSteps];
  uint8_t xlen[kMaxEuclidSteps] = {}, ylen[kMaxEuclidSteps] = {};
  for (int32_t i = 0; i < ons; ++i) { xs[i][0] = 1; xlen[i] = 1; }
  for (int32_t i = 0; i < offs; ++i) { ys[i][0] = 0; ylen[i] = 1; }
  int32_t xn = ons, yn = offs;

  const auto zip = [](uint8_t (*dst)[kMaxEuclidSteps], uint8_t* dstLen,
                      const uint8_t (*src)[kMaxEuclidSteps], const uint8_t* srcLen, int32_t n) {
    for (int32_t i = 0; i < n; ++i) {
      for (uint8_t k = 0; k < srcLen[i]; ++k) dst[i][dstLen[i] + k] = src[i][k];
      dstLen[i] = static_cast<uint8_t>(dstLen[i] + srcLen[i]);
    }
  };
  const auto drop = [](uint8_t (*g)[kMaxEuclidSteps], uint8_t* len, int32_t from, int32_t n) {
    for (int32_t i = 0; i < n; ++i) {
      len[i] = len[from + i];
      for (uint8_t k = 0; k < len[i]; ++k) g[i][k] = g[from + i][k];
    }
  };

  while ((xn < yn ? xn : yn) > 1) {
    if (xn > yn) {
      // left: each of the first `yn` x-groups takes a y-group; the rest of x becomes the new y.
      const int32_t keep = yn;
      const int32_t rest = xn - yn;
      zip(xs, xlen, ys, ylen, keep);
      for (int32_t i = 0; i < rest; ++i) {
        ylen[i] = xlen[keep + i];
        for (uint8_t k = 0; k < ylen[i]; ++k) ys[i][k] = xs[keep + i][k];
      }
      xn = keep;
      yn = rest;
    } else {
      // right: each x-group takes a y-group; what is left of y stays y.
      const int32_t keep = xn;
      const int32_t rest = yn - xn;
      zip(xs, xlen, ys, ylen, keep);
      drop(ys, ylen, keep, rest);
      yn = rest;
    }
  }

  int32_t written = 0;
  for (int32_t g = 0; g < xn && written < steps; ++g)
    for (uint8_t k = 0; k < xlen[g] && written < steps; ++k) out[written++] = xs[g][k];
  for (int32_t g = 0; g < yn && written < steps; ++g)
    for (uint8_t k = 0; k < ylen[g] && written < steps; ++k) out[written++] = ys[g][k];
  while (written < steps) out[written++] = 0;

  if (inverted)
    for (int32_t i = 0; i < steps; ++i) out[i] = out[i] ? 0 : 1;

  if (rotation != 0) {
    uint8_t rotated[kMaxEuclidSteps];
    for (int32_t i = 0; i < steps; ++i) {
      int32_t from = (i - rotation) % steps;
      if (from < 0) from += steps;
      rotated[i] = out[from];
    }
    for (int32_t i = 0; i < steps; ++i) out[i] = rotated[i];
  }
  return true;
}

uint32_t query(const Program& program, const TimeSpan& span, Hap* out, uint32_t capacity,
               bool& overflowed) {
  overflowed = false;
  if (program.empty() || out == nullptr || capacity == 0) return 0;
  Query q{program, out, capacity};
  queryNode(q, program.root, span);
  overflowed = q.overflowed;
  return q.count;
}

}  // namespace pg::pattern

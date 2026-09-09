#pragma once
/*
 * Evaluating a parsed pattern: a tree walk over the arena `Mini.cpp` built.
 *
 * Ported from TidalCycles (Alex McLean) by way of Strudel's `packages/core/pattern.mjs`
 * <https://codeberg.org/uzu/strudel>, AGPL-3.0-or-later, the same licence as this project.
 *
 * Strudel builds a graph of closures and a query calls through it. This does the same work as a
 * recursion over flat arrays, because the query runs on the AUDIO THREAD: a closure graph
 * allocates, and so does a query that answers with a `std::vector`. Everything here writes into a
 * caller-owned array, recurses to a depth the parser has already bounded, and touches no memory
 * it did not arrive with.
 */
#include <cstdint>
#include "pattern/Mini.hpp"
#include "pattern/TimeSpan.hpp"

namespace pg::pattern {

/// The most events one query may answer with. A cycle of mini-notation that wants more than this
/// is denser than anything a person writes, and the bound is what makes the query allocation-free.
inline constexpr uint32_t kMaxHapsPerQuery = 256;

/// Queries `program` over `span`, appending to `out`.
///
/// Returns the number written. `overflowed` is set when there was more to say than `capacity`
/// allowed -- a caller that cares can report it; a caller that does not gets a truncated cycle
/// rather than a scribble past the end of its array.
uint32_t query(const Program& program, const TimeSpan& span, Hap* out, uint32_t capacity,
               bool& overflowed);

/// The random signal Strudel's `?` and `|` draw on, sampled at a point in cycle time.
///
/// Ported exactly, bit pattern and all (`packages/core/signal.mjs`, the 'legacy' RNG): a pattern
/// written in Strudel has to degrade the same way here, and "similar noise" is not the same thing.
double randAt(double t);

/// The Bjorklund/euclidean rhythm: `pulses` onsets spread as evenly as possible over `steps`.
/// Writes `steps` bytes into `out`, which must hold `kMaxEuclidSteps`. False if the arguments are
/// out of range.
bool bjorklund(int32_t pulses, int32_t steps, int32_t rotation, uint8_t* out);

}  // namespace pg::pattern

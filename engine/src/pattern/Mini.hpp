#pragma once
/*
 * Tidal/Strudel mini-notation: the parse, and the pattern it lowers to.
 *
 * The grammar is TidalCycles' (Alex McLean, 2009), reached here through Strudel's `krill.pegjs`
 * <https://codeberg.org/uzu/strudel>, AGPL-3.0-or-later -- the same licence as this project. This
 * is a hand-written recursive-descent port, not vendored code.
 *
 * A parse produces a flat arena of POD nodes, and evaluating it is a tree walk over that arena
 * (`Pattern.hpp`). That is the whole reason it is shaped this way rather than as the graph of
 * closures Strudel builds: the query runs on the AUDIO thread, and a closure graph allocates.
 * Parsing happens once, on the message thread, in `Module::configure`.
 */
#include <cstdint>
#include <string>
#include <vector>
#include "pattern/Fraction.hpp"

namespace pg::pattern {

/// What the numbers in a pattern string mean, which decides what an atom is allowed to be.
enum class AtomMode : uint8_t {
  /// A note name (`c`, `eb4`, `f#2`) or a MIDI number. Anything else is an error.
  Note,
  /// A plain number. A bare word is an error.
  Number,
  /// A pulse or a gap, for `struct`: 0 is a gap, anything else is a pulse.
  Boolean,
};

/// One leaf of the pattern, with where it came from.
///
/// `from`/`to` are byte offsets into the pattern string. They exist so an interface can outline
/// the step that is sounding without parsing the string a second time -- the engine already knows.
struct Atom {
  float value = 0.f;
  uint32_t from = 0;
  uint32_t to = 0;
};

enum class NodeKind : uint8_t {
  Silence,
  Pure,          ///< one atom, once per cycle
  Stack,         ///< every child at once
  SlowCat,       ///< one child per cycle, in turn
  Fast,          ///< child sped up by `factor`
  FastGap,       ///< child squeezed into the head of each cycle, leaving a gap
  Late,          ///< child shifted later by `factor`
  RepeatCycles,  ///< each of the child's cycles held for `count` cycles
  Degrade,       ///< `?`: drop haps whose random draw is below `factor`
  Choose,        ///< `|`: one child per cycle, chosen at random
  InnerFast,     ///< `*` with a patterned factor
  InnerSlow,     ///< `/` with a patterned factor
  Euclid,        ///< `( , , )` -- the child against a bjorklund rhythm
  Tail,          ///< `:` -- a second number carried alongside the value
  Range,         ///< `..` -- the run of integers between two values, squeezed into each step
};

/// One node. Children are a contiguous run in `Program::children`, so a node is a POD and the
/// whole tree is three flat vectors that the audio thread only ever reads.
struct Node {
  NodeKind kind = NodeKind::Silence;
  uint32_t firstChild = 0;
  uint32_t childCount = 0;
  /// Fast/FastGap: the factor. Late: the shift. Degrade: the threshold. RepeatCycles: the count.
  Fraction factor{1};
  /// Node indices. `argA` is the pattern being modified; `argB`..`argD` are the arguments, which
  /// are themselves patterns, because `c*<2 3>` and `c(<3 5>,8)` are legal.
  uint32_t argA = 0, argB = 0, argC = 0, argD = 0;
  bool hasArgD = false;
  /// Decorrelates one `?` or `|` from the next, exactly as Strudel's parse-time counter does.
  uint32_t seed = 0;
  int32_t atom = -1;
};

/// The most steps a euclidean rhythm may be spread over. Bjorklund runs on the audio thread into
/// a buffer this size, so it is what keeps that allocation-free.
inline constexpr uint32_t kMaxEuclidSteps = 64;

/// A parsed pattern: the arena, plus the root.
struct Program {
  std::vector<Node> nodes;
  std::vector<uint32_t> children;
  std::vector<Atom> atoms;
  uint32_t root = 0;
  bool empty() const { return nodes.empty(); }
};

/// How deeply a pattern may nest, and how much of it there may be.
///
/// The query is a recursion on the audio thread, so its depth has to be bounded somewhere, and a
/// bound the parser enforces is a bound the audio thread never has to check. A pattern past any of
/// these is rejected WHOLE, the way `notes.clip` rejects a malformed note list: a loud nothing
/// beats a quiet half-reading.
inline constexpr uint32_t kMaxDepth = 12;
inline constexpr uint32_t kMaxNodes = 1024;
inline constexpr uint32_t kMaxAtoms = 512;

/// Parses mini-notation. Returns false and fills `error` if the string is not valid, leaving
/// `out` empty. An empty or all-whitespace string parses to an empty program, which is silence.
bool parseMini(const std::string& source, AtomMode mode, Program& out, std::string& error);

/// A note name to a MIDI number, Strudel's rule (`packages/core/util.mjs`).
///
/// The default octave is 3 and the octave formula is `(oct + 1) * 12`, so a bare `c` is 48 and
/// MIDDLE C IS `c4`, not `c3`. That is one octave above the reading most people expect, and it is
/// kept because a pattern copied out of Strudel has to sound the same here.
bool noteNameToMidi(const char* text, uint32_t length, float& out);

}  // namespace pg::pattern

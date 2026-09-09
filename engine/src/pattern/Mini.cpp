/*
 * The mini-notation parser: source text to the node arena `Pattern.cpp` walks.
 *
 * Ported from TidalCycles (Alex McLean) by way of Strudel's `krill.pegjs` and `mini.mjs`
 * <https://codeberg.org/uzu/strudel>, AGPL-3.0-or-later, the same licence as this project.
 *
 * The grammar's second half -- the haskell-ish `struct "..." $ "..."` operator forms -- is not
 * ported, because it does not work in Strudel either: `patternifyAST` has no arm for struct,
 * bjorklund, shift or stretch and warns "not implemented -> returning silence". It is notation
 * the grammar accepts and the evaluator throws away, so there is nothing to be compatible with.
 * `cat [...]` is the one construct in that half that does work, and it is ported.
 */
#include "pattern/Mini.hpp"

#include <cmath>
#include <cstdlib>
#include <cstring>

namespace pg::pattern {
namespace {

bool isStepChar(char c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
         c == '~' || c == '-' || c == '#' || c == '.' || c == '^' || c == '_';
}

bool isSpace(char c) { return c == ' ' || c == '\n' || c == '\r' || c == '\t'; }

/// One member of a sequence: the pattern it became, and how many steps wide it is.
struct Element {
  uint32_t node = 0;
  Fraction weight{1};
};

struct Parser {
  const std::string& src;
  AtomMode mode;
  Program& p;
  std::string& err;
  size_t pos = 0;
  uint32_t seed = 0;    // shared by `?`, `|` and `.`, in parse order, exactly as krill's is
  uint32_t depth = 0;

  Parser(const std::string& s, AtomMode m, Program& prog, std::string& e)
    : src(s), mode(m), p(prog), err(e) {}

  bool fail(const char* what) {
    if (err.empty()) err = std::string(what) + " at offset " + std::to_string(pos);
    return false;
  }

  bool atEnd() const { return pos >= src.size(); }
  char peek() const { return pos < src.size() ? src[pos] : '\0'; }
  void skipWs() { while (pos < src.size() && isSpace(src[pos])) ++pos; }

  uint32_t add(NodeKind kind) {
    p.nodes.push_back(Node{});
    p.nodes.back().kind = kind;
    return static_cast<uint32_t>(p.nodes.size() - 1);
  }

  /// Files a run of children and points `node` at it. Children must be complete by now: the
  /// arena is append-only and a run has to be contiguous.
  void attach(uint32_t node, const std::vector<uint32_t>& kids) {
    p.nodes[node].firstChild = static_cast<uint32_t>(p.children.size());
    p.nodes[node].childCount = static_cast<uint32_t>(kids.size());
    p.children.insert(p.children.end(), kids.begin(), kids.end());
  }

  bool overBudget() {
    if (p.nodes.size() > kMaxNodes) return fail("pattern is too big");
    if (p.atoms.size() > kMaxAtoms) return fail("pattern has too many steps");
    return false;
  }

  // --- combinators, built the way `mini.mjs` builds them --------------------------------------

  uint32_t fast(uint32_t child, Fraction factor) {
    if (factor == Fraction(1)) return child;
    if (factor.isZero()) return add(NodeKind::Silence);
    const uint32_t n = add(NodeKind::Fast);
    p.nodes[n].argA = child;
    p.nodes[n].factor = factor;
    return n;
  }

  uint32_t late(uint32_t child, Fraction amount) {
    if (amount.isZero()) return child;
    const uint32_t n = add(NodeKind::Late);
    p.nodes[n].argA = child;
    p.nodes[n].factor = amount;
    return n;
  }

  uint32_t fastGap(uint32_t child, Fraction factor) {
    const uint32_t n = add(NodeKind::FastGap);
    p.nodes[n].argA = child;
    p.nodes[n].factor = factor;
    return n;
  }

  /// `compress(b, e)`: the child squeezed into `[b, e)` of every cycle.
  uint32_t compress(uint32_t child, Fraction b, Fraction e) {
    if (b > e || b > Fraction(1) || e > Fraction(1) || b < Fraction(0) || e < Fraction(0))
      return add(NodeKind::Silence);
    return late(fastGap(child, Fraction(1) / (e - b)), b);
  }

  uint32_t stackOf(const std::vector<uint32_t>& kids) {
    if (kids.empty()) return add(NodeKind::Silence);
    if (kids.size() == 1) return kids[0];
    const uint32_t n = add(NodeKind::Stack);
    attach(n, kids);
    return n;
  }

  uint32_t slowCatOf(const std::vector<uint32_t>& kids) {
    if (kids.empty()) return add(NodeKind::Silence);
    if (kids.size() == 1) return kids[0];
    const uint32_t n = add(NodeKind::SlowCat);
    attach(n, kids);
    return n;
  }

  /// `fastcat`: the children crammed one after another into a single cycle.
  uint32_t fastCatOf(const std::vector<uint32_t>& kids) {
    if (kids.empty()) return add(NodeKind::Silence);
    return fast(slowCatOf(kids), Fraction(static_cast<int64_t>(kids.size())));
  }

  /// A sequence of elements laid across one cycle: `timeCat`, a stack of compressed slots.
  ///
  /// Always `timeCat`, never `fastcat`, even when every element is one step wide -- because that
  /// is what mini-notation does. Every element it parses carries `weight: 1`, and Strudel's
  /// "does any child have a weight?" test is a truthiness test, so the weighted path is the only
  /// one a mini string ever takes. It matters: `timeCat` stacks the slots, so `[c e]*2` answers
  /// c, c, e, e where a `fastcat` would answer c, e, c, e.
  uint32_t sequenceOf(const std::vector<Element>& elements) {
    if (elements.empty()) return add(NodeKind::Silence);
    Fraction total{0};
    for (const Element& e : elements) total = total + e.weight;
    if (total.isZero()) return add(NodeKind::Silence);
    std::vector<uint32_t> slots;
    Fraction begin{0};
    for (const Element& e : elements) {
      if (e.weight.isZero()) continue;
      const Fraction end = begin + e.weight;
      slots.push_back(compress(e.node, begin / total, end / total));
      begin = end;
    }
    return stackOf(slots);
  }

  // --- the grammar ----------------------------------------------------------------------------

  /// `number` -- a plain decimal, possibly signed.
  bool parseNumber(double& out) {
    const char* start = src.c_str() + pos;
    char* end = nullptr;
    const double v = std::strtod(start, &end);
    if (end == start || !std::isfinite(v)) return false;
    pos += static_cast<size_t>(end - start);
    out = v;
    return true;
  }

  /// The atom's value, given the text it was written as and what the field means.
  bool atomValue(size_t from, size_t to, float& out) {
    const std::string text = src.substr(from, to - from);
    char* end = nullptr;
    const double v = std::strtod(text.c_str(), &end);
    const bool numeric = end == text.c_str() + text.size() && end != text.c_str() && std::isfinite(v);
    if (numeric) { out = static_cast<float>(v); return true; }
    if (mode == AtomMode::Boolean) { out = 1.f; return true; }   // any word is a pulse
    if (mode == AtomMode::Note &&
        noteNameToMidi(text.c_str(), static_cast<uint32_t>(text.size()), out))
      return true;
    err = "\"" + text + "\" is not " +
          (mode == AtomMode::Note ? "a note or a number" : "a number");
    return false;
  }

  /// `step` -- a run of step characters. A bare `.` or `_` is not a step; those are the foot
  /// separator and the elongation operator, and krill excludes them here for exactly that reason.
  bool parseStep(uint32_t& out) {
    skipWs();
    const size_t from = pos;
    while (pos < src.size() && isStepChar(src[pos])) ++pos;
    if (pos == from) return false;
    const size_t to = pos;
    const std::string text = src.substr(from, to - from);
    if (text == "." || text == "_") { pos = from; return false; }
    skipWs();
    if (text == "~" || text == "-") { out = add(NodeKind::Silence); return true; }
    float value = 0.f;
    if (!atomValue(from, to, value)) { out = 0; return false; }
    p.atoms.push_back(Atom{value, static_cast<uint32_t>(from), static_cast<uint32_t>(to)});
    out = add(NodeKind::Pure);
    p.nodes[out].atom = static_cast<int32_t>(p.atoms.size() - 1);
    return true;
  }

  /// `slice` -- a step, a `[...]`, a `{...}` or a `<...>`. `steps` is how many steps wide it is,
  /// which `<>` and `{}` need from their children.
  bool parseSlice(uint32_t& out, Fraction& steps) {
    skipWs();
    steps = Fraction(1);
    const char c = peek();
    if (c == '[') {
      ++pos;
      if (++depth > kMaxDepth) return fail("pattern nests too deeply");
      if (!parseStackOrChoose(out, steps)) return false;
      --depth;
      skipWs();
      if (peek() != ']') return fail("expected ]");
      ++pos;
      skipWs();
      return true;
    }
    if (c == '<' || c == '{') {
      const char close = c == '<' ? '>' : '}';
      ++pos;
      if (++depth > kMaxDepth) return fail("pattern nests too deeply");
      std::vector<uint32_t> kids;
      std::vector<Fraction> weights;
      for (;;) {
        uint32_t child = 0;
        Fraction w{0};
        if (!parseSequence(child, w)) return false;
        kids.push_back(child);
        weights.push_back(w);
        skipWs();
        if (peek() != ',') break;
        ++pos;
      }
      --depth;
      skipWs();
      if (peek() != close) return fail(close == '>' ? "expected >" : "expected }");
      ++pos;
      skipWs();
      if (close == '>') {
        // `<a b c>`: each child slowed by its own step count, so one step sounds per cycle.
        std::vector<uint32_t> slowed;
        for (size_t i = 0; i < kids.size(); ++i)
          slowed.push_back(weights[i].isZero() ? kids[i]
                                               : fast(kids[i], Fraction(1) / weights[i]));
        out = stackOf(slowed);
        steps = Fraction(1);
        return true;
      }
      // `{a b, c d e}%n`: every child stretched so that `n` of its steps fall in a cycle.
      Fraction perCycle = weights.empty() ? Fraction(1) : weights[0];
      uint32_t perCycleNode = 0;
      bool perCyclePatterned = false;
      if (peek() == '%') {
        ++pos;
        Fraction inner{1};
        if (!parseSlice(perCycleNode, inner)) return fail("expected a step count after %");
        if (p.nodes[perCycleNode].kind == NodeKind::Pure) {
          const double v = p.atoms[static_cast<size_t>(p.nodes[perCycleNode].atom)].value;
          perCycle = fractionOf(v);
        } else {
          perCyclePatterned = true;
        }
        skipWs();
      }
      std::vector<uint32_t> aligned;
      for (size_t i = 0; i < kids.size(); ++i) {
        const Fraction w = weights[i].isZero() ? Fraction(1) : weights[i];
        if (perCyclePatterned) {
          const uint32_t n = add(NodeKind::InnerFast);
          p.nodes[n].argA = kids[i];
          p.nodes[n].argB = perCycleNode;
          p.nodes[n].factor = Fraction(1) / w;
          aligned.push_back(n);
        } else {
          aligned.push_back(fast(kids[i], perCycle / w));
        }
      }
      out = stackOf(aligned);
      steps = perCycle;
      return true;
    }
    return parseStep(out);
  }

  /// A decimal as an exact rational, so `c*2.5` divides time the way `c*5/2` does.
  static Fraction fractionOf(double v) {
    // Mini-notation numbers are written by hand; three decimal places is far past what anyone
    // types, and keeping the denominator small keeps every later sum exact.
    const int64_t den = 1000;
    return Fraction(static_cast<int64_t>(std::llround(v * static_cast<double>(den))), den);
  }

  /// `slice_with_ops` -- a slice and the operators hanging off it.
  bool parseSliceWithOps(Element& out) {
    uint32_t node = 0;
    Fraction steps{1};
    if (!parseSlice(node, steps)) return false;
    Fraction weight{1};
    Fraction reps{1};
    for (;;) {
      const size_t mark = pos;
      skipWs();
      const char c = peek();
      // `@` and `_` take leading whitespace; the rest bind tight to what they follow.
      if (c == '@' || c == '_') {
        ++pos;
        double a = 2.0;
        parseNumber(a);
        weight = weight + fractionOf(a) - Fraction(1);
        continue;
      }
      if (c == '!') {
        ++pos;
        double a = 2.0;
        parseNumber(a);
        reps = reps + fractionOf(a) - Fraction(1);
        weight = reps;
        continue;
      }
      pos = mark;
      const char t = peek();
      if (t == '*' || t == '/') {
        ++pos;
        uint32_t arg = 0;
        Fraction ignored{1};
        if (!parseSlice(arg, ignored)) return fail("expected a factor");
        if (p.nodes[arg].kind == NodeKind::Pure) {
          const Fraction f = fractionOf(p.atoms[static_cast<size_t>(p.nodes[arg].atom)].value);
          node = t == '*' ? fast(node, f)
                          : (f.isZero() ? add(NodeKind::Silence) : fast(node, Fraction(1) / f));
        } else {
          const uint32_t n = add(NodeKind::InnerFast);
          p.nodes[n].kind = t == '*' ? NodeKind::InnerFast : NodeKind::InnerSlow;
          p.nodes[n].argA = node;
          p.nodes[n].argB = arg;
          p.nodes[n].factor = Fraction(1);
          node = n;
        }
        continue;
      }
      if (t == '?') {
        ++pos;
        double amount = 0.5;
        parseNumber(amount);
        const uint32_t n = add(NodeKind::Degrade);
        p.nodes[n].argA = node;
        p.nodes[n].factor = fractionOf(amount);
        p.nodes[n].seed = seed++;
        node = n;
        continue;
      }
      if (t == ':') {
        ++pos;
        uint32_t arg = 0;
        Fraction ignored{1};
        if (!parseSlice(arg, ignored)) return fail("expected a value after :");
        const uint32_t n = add(NodeKind::Tail);
        p.nodes[n].argA = node;
        p.nodes[n].argB = arg;
        node = n;
        continue;
      }
      if (t == '(') {
        ++pos;
        uint32_t args[3] = {0, 0, 0};
        uint32_t count = 0;
        for (; count < 3; ++count) {
          Fraction ignored{1};
          if (!parseSlice(args[count], ignored)) return fail("expected a euclid argument");
          skipWs();
          if (peek() != ',') { ++count; break; }
          ++pos;
        }
        if (count < 2) return fail("euclid takes at least a pulse count and a step count");
        if (peek() != ')') return fail("expected )");
        ++pos;
        const uint32_t n = add(NodeKind::Euclid);
        p.nodes[n].argA = node;
        p.nodes[n].argB = args[0];
        p.nodes[n].argC = args[1];
        p.nodes[n].argD = args[2];
        p.nodes[n].hasArgD = count > 2;
        node = n;
        continue;
      }
      if (t == '.' && pos + 1 < src.size() && src[pos + 1] == '.') {
        pos += 2;
        uint32_t arg = 0;
        Fraction ignored{1};
        if (!parseSlice(arg, ignored)) return fail("expected the end of a range");
        const uint32_t n = add(NodeKind::Range);
        p.nodes[n].argA = node;
        p.nodes[n].argB = arg;
        node = n;
        continue;
      }
      break;
    }
    if (reps != Fraction(1)) {
      // `a!3` is three of a's cycles held and then crammed into one, which is what makes it
      // differ from `a*3`: the source cycle is repeated rather than run three times.
      const uint32_t r = add(NodeKind::RepeatCycles);
      p.nodes[r].argA = node;
      p.nodes[r].factor = reps;
      node = fast(r, reps);
    }
    out = Element{node, weight};
    return overBudget() ? false : true;
  }

  /// `sequence` -- one or more slices side by side across a cycle.
  bool parseSequence(uint32_t& out, Fraction& weightSum) {
    std::vector<Element> elements;
    weightSum = Fraction(0);
    for (;;) {
      skipWs();
      const char c = peek();
      if (atEnd() || c == ']' || c == '>' || c == '}' || c == ',' || c == '|' || c == ')') break;
      if (c == '.' && !(pos + 1 < src.size() && isStepChar(src[pos + 1]))) break;
      Element e;
      const size_t mark = pos;
      if (!parseSliceWithOps(e)) {
        if (!err.empty()) return false;
        pos = mark;
        break;
      }
      elements.push_back(e);
      weightSum = weightSum + e.weight;
    }
    if (elements.empty()) { out = add(NodeKind::Silence); weightSum = Fraction(0); return true; }
    out = sequenceOf(elements);
    return true;
  }

  /// `stack_or_choose` -- sequences joined by `,` (at once), `|` (one at random) or `.` (feet).
  bool parseStackOrChoose(uint32_t& out, Fraction& steps) {
    uint32_t head = 0;
    Fraction headSteps{0};
    if (!parseSequence(head, headSteps)) return false;
    skipWs();
    const char c = peek();
    if (c != ',' && c != '|' && c != '.') { out = head; steps = headSteps; return true; }

    std::vector<uint32_t> kids{head};
    std::vector<Fraction> stepCounts{headSteps};
    while (peek() == c) {
      ++pos;
      uint32_t child = 0;
      Fraction childSteps{0};
      if (!parseSequence(child, childSteps)) return false;
      kids.push_back(child);
      stepCounts.push_back(childSteps);
      skipWs();
    }
    steps = headSteps;
    if (c == ',') { out = stackOf(kids); return true; }
    if (c == '.') {
      // Feet: each group becomes one step of a sequence. krill burns a seed here even though
      // nothing random happens, and the seeds have to line up with Strudel's.
      ++seed;
      out = fastCatOf(kids);
      steps = Fraction(static_cast<int64_t>(kids.size()));
      return true;
    }
    const uint32_t n = add(NodeKind::Choose);
    attach(n, kids);
    p.nodes[n].seed = seed++;
    out = n;
    return true;
  }
};

/// `cat [ "...", "..." ]` -- the one construct outside mini-notation proper that Strudel
/// implements.
///
/// Despite the name it is NOT a slowcat: `patternifyAST` has no arm for the `slowcat` alignment
/// its AST asks for, so it falls through to the default and becomes a plain sequence. The members
/// therefore share a cycle rather than taking one each, and that is what is ported.
bool parseCat(const std::string& src, size_t start, AtomMode mode, Program& out,
              std::string& error) {
  size_t pos = start + 3;
  auto ws = [&] { while (pos < src.size() && isSpace(src[pos])) ++pos; };
  ws();
  if (pos >= src.size() || src[pos] != '[') { error = "expected [ after cat"; return false; }
  ++pos;
  std::vector<uint32_t> kids;
  for (;;) {
    ws();
    if (pos >= src.size()) { error = "expected ] to close cat"; return false; }
    if (src[pos] == ']') { ++pos; break; }
    const char quote = src[pos];
    if (quote != '"' && quote != '\'') { error = "cat takes quoted patterns"; return false; }
    const size_t from = ++pos;
    while (pos < src.size() && src[pos] != quote) ++pos;
    if (pos >= src.size()) { error = "unterminated string in cat"; return false; }
    // Parsed in place, so every atom's character range still points into the whole source and an
    // interface can highlight the step inside the quotes it was written in.
    Parser inner(src, mode, out, error);
    inner.pos = from;
    uint32_t child = 0;
    Fraction steps{0};
    if (!inner.parseStackOrChoose(child, steps)) return false;
    if (inner.pos != pos) { error = "unexpected text in a cat pattern"; return false; }
    kids.push_back(child);
    ++pos;
    ws();
    if (pos < src.size() && src[pos] == ',') ++pos;
  }
  ws();
  if (pos != src.size()) { error = "unexpected text after cat"; return false; }
  if (kids.empty()) { out.nodes.push_back(Node{}); out.root = 0; return true; }
  Parser build(src, mode, out, error);
  out.root = build.fastCatOf(kids);
  return true;
}

}  // namespace

bool noteNameToMidi(const char* text, uint32_t length, float& out) {
  if (length == 0) return false;
  static constexpr int kChroma[7] = {9, 11, 0, 2, 4, 5, 7};   // a b c d e f g
  const char head = text[0];
  const char lower = (head >= 'A' && head <= 'Z') ? static_cast<char>(head - 'A' + 'a') : head;
  if (lower < 'a' || lower > 'g') return false;
  int value = kChroma[lower - 'a'];
  uint32_t i = 1;
  for (; i < length; ++i) {
    const char c = text[i];
    if (c == '#' || c == 's') ++value;
    else if (c == 'b' || c == 'f') --value;
    else break;
  }
  int octave = 3;   // Strudel's default: a bare `c` is 48, and middle C is written `c4`
  if (i < length) {
    int sign = 1;
    if (text[i] == '-') { sign = -1; ++i; }
    if (i == length) return false;
    int digits = 0;
    octave = 0;
    for (; i < length; ++i) {
      if (text[i] < '0' || text[i] > '9') return false;
      octave = octave * 10 + (text[i] - '0');
      if (++digits > 2) return false;
    }
    octave *= sign;
  }
  out = static_cast<float>((octave + 1) * 12 + value);
  return true;
}

bool parseMini(const std::string& source, AtomMode mode, Program& out, std::string& error) {
  out = Program{};
  error.clear();
  size_t first = 0;
  while (first < source.size() && isSpace(source[first])) ++first;
  if (first == source.size()) return true;   // nothing written is silence, not an error

  if (source.compare(first, 3, "cat") == 0 &&
      (first + 3 == source.size() || !isStepChar(source[first + 3]))) {
    Program program;
    if (!parseCat(source, first, mode, program, error)) { out = Program{}; return false; }
    out = std::move(program);
    return true;
  }

  Program program;
  Parser parser(source, mode, program, error);
  uint32_t root = 0;
  Fraction steps{0};
  if (!parser.parseStackOrChoose(root, steps)) { out = Program{}; return false; }
  parser.skipWs();
  if (!parser.atEnd()) {
    error = "unexpected \"" + source.substr(parser.pos, 1) + "\" at offset " +
            std::to_string(parser.pos);
    out = Program{};
    return false;
  }
  program.root = root;
  out = std::move(program);
  return true;
}

}  // namespace pg::pattern

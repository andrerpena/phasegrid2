/*
 * The mini-notation port, checked against Strudel itself.
 *
 * `golden/mini.json` is not written by hand: it is what the real Strudel
 * (`@strudel/mini` + `@strudel/core`) answers for each of these patterns, dumped as exact
 * rationals. So this is a conformance suite, not a description of what the port happens to do --
 * a pattern copied out of Strudel has to sound the same here, and "close enough" in the timing of
 * a note is a wrong note.
 *
 * Regenerating it needs a Strudel checkout; see docs/engine.md.
 */
#include <catch2/catch_test_macros.hpp>
#include <cstdlib>
#include <fstream>
#include <nlohmann/json.hpp>
#include <string>
#include <vector>
#include "pattern/Mini.hpp"
#include "pattern/Pattern.hpp"
#include "util/RtGuard.hpp"

using namespace pg::pattern;

namespace {

Fraction fractionOf(const nlohmann::json& j) {
  return Fraction(j.at(0).get<int64_t>(), j.at(1).get<int64_t>());
}

std::string describe(const Fraction& f) {
  return std::to_string(f.n) + "/" + std::to_string(f.d);
}

/// The text an event came from, which is what the fixture records as its value: comparing the
/// SOURCE rather than a number means the note-name conversion is tested separately from the
/// timing, and a failure says which of the two broke.
std::string atomText(const std::string& source, const Program& program, const Hap& hap) {
  if (hap.atom < 0) return "?";
  const Atom& atom = program.atoms[static_cast<size_t>(hap.atom)];
  return source.substr(atom.from, atom.to - atom.from);
}

nlohmann::json loadFixture() {
  std::ifstream in(std::string(PG_TEST_DIR) + "/golden/mini.json");
  REQUIRE(in.good());
  nlohmann::json j;
  in >> j;
  return j;
}

}  // namespace

TEST_CASE("mini-notation matches Strudel", "[mini]") {
  const nlohmann::json fixture = loadFixture();

  for (const auto& testCase : fixture.at("cases")) {
    const std::string source = testCase.at("pattern").get<std::string>();
    const int cycles = testCase.at("cycles").get<int>();

    INFO("pattern: " << source);
    Program program;
    std::string error;
    // Every fixture value is either a number or a note name, so `Note` reads them all. The mode
    // only decides what a bare word is allowed to mean; it does not touch the timing.
    REQUIRE(parseMini(source, AtomMode::Note, program, error));
    REQUIRE(error.empty());

    std::vector<Hap> haps;
    for (int cycle = 0; cycle < cycles; ++cycle) {
      Hap out[kMaxHapsPerQuery];
      bool overflowed = false;
      const uint32_t count =
        query(program, TimeSpan(Fraction(cycle), Fraction(cycle + 1)), out, kMaxHapsPerQuery,
              overflowed);
      REQUIRE_FALSE(overflowed);
      haps.insert(haps.end(), out, out + count);
    }

    const auto& expected = testCase.at("haps");
    {
      INFO("expected " << expected.size() << " events, got " << haps.size());
      REQUIRE(haps.size() == expected.size());
    }
    for (size_t i = 0; i < haps.size(); ++i) {
      const Hap& got = haps[i];
      const auto& want = expected[i];
      INFO("event " << i << ": whole " << describe(got.whole.begin) << ".."
                    << describe(got.whole.end) << " part " << describe(got.part.begin) << ".."
                    << describe(got.part.end) << " value " << atomText(source, program, got));
      REQUIRE(got.hasWhole);
      CHECK(got.whole.begin == fractionOf(want.at("wb")));
      CHECK(got.whole.end == fractionOf(want.at("we")));
      CHECK(got.part.begin == fractionOf(want.at("pb")));
      CHECK(got.part.end == fractionOf(want.at("pe")));
      // A note name is compared as the text it was written as, which keeps the timing test
      // independent of the name-to-MIDI conversion (that has its own test below). A number is
      // compared as a number, because `0 .. 3` invents values that were never written down.
      const std::string wanted = want.at("v").get<std::string>();
      char* end = nullptr;
      const double numeric = std::strtod(wanted.c_str(), &end);
      if (end == wanted.c_str() + wanted.size() && !wanted.empty())
        CHECK(static_cast<double>(got.value) == numeric);
      else
        CHECK(atomText(source, program, got) == wanted);
      if (want.contains("t")) {
        CHECK(got.hasTail);
        CHECK(static_cast<double>(got.tail) == want.at("t").get<double>());
      }
    }
  }
}

TEST_CASE("note names match Strudel", "[mini]") {
  const nlohmann::json fixture = loadFixture();
  for (const auto& [name, midi] : fixture.at("notes").items()) {
    INFO("note: " << name);
    float value = 0.f;
    REQUIRE(noteNameToMidi(name.c_str(), static_cast<uint32_t>(name.size()), value));
    CHECK(static_cast<double>(value) == midi.get<double>());
  }
}

TEST_CASE("a pattern that will not parse is rejected whole", "[mini]") {
  // A half-read pattern is a wrong pattern that plays, which is worse than one that does not:
  // the module treats a parse failure as silence, the way `notes.clip` treats a malformed note.
  for (const char* bad : {"c [e", "c ]", "zz", "c (3", "c *", "<c e"}) {
    INFO("pattern: " << bad);
    Program program;
    std::string error;
    CHECK_FALSE(parseMini(bad, AtomMode::Note, program, error));
    CHECK_FALSE(error.empty());
    CHECK(program.empty());
  }
}

TEST_CASE("an empty pattern is silence, not an error", "[mini]") {
  for (const char* quiet : {"", "   ", "\n\t "}) {
    Program program;
    std::string error;
    CHECK(parseMini(quiet, AtomMode::Note, program, error));
    CHECK(error.empty());
    CHECK(program.empty());
    Hap out[4];
    bool overflowed = false;
    CHECK(query(program, TimeSpan(Fraction(0), Fraction(1)), out, 4, overflowed) == 0);
  }
}

TEST_CASE("a number pattern refuses a note name", "[mini]") {
  Program program;
  std::string error;
  CHECK_FALSE(parseMini("c e g", AtomMode::Number, program, error));
  CHECK(parseMini("1 .5 .25", AtomMode::Number, program, error));
}

TEST_CASE("querying a pattern allocates nothing", "[mini][rt]") {
  // The query runs on the audio thread every time the playhead crosses a cycle. This is the test
  // that keeps it that way; `test_rt_alloc` covers the module that calls it.
  Program program;
  std::string error;
  REQUIRE(parseMini("<c eb>*2 [g,b] c@2 e(3,8) f? a|d", AtomMode::Note, program, error));
  Hap out[kMaxHapsPerQuery];
  bool overflowed = false;
  pg::test::resetRtViolations();
  {
    pg::test::RtScope guard;
    for (int cycle = 0; cycle < 8; ++cycle)
      query(program, TimeSpan(Fraction(cycle), Fraction(cycle + 1)), out, kMaxHapsPerQuery,
            overflowed);
  }
  CHECK(pg::test::rtViolations() == 0);
  CHECK_FALSE(overflowed);
}

#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <nlohmann/json.hpp>
#include <stdexcept>
#include "modules/builtin.hpp"
#include "util/GraphFixture.hpp"

using pg::test::GraphFixture;

TEST_CASE("compile: chain const -> gain", "[compiler]") {
  GraphFixture f;
  f.node("c", "test.const", {{"value", 0.5f}});
  f.node("g", "test.gain", {{"gain", 0.5f}});
  f.edge("e", "c.out", "g.in");
  auto p = f.compile();
  f.run(*p, 64);
  REQUIRE(f.out(*p, "g", "out", 63) == Catch::Approx(0.25f));
  REQUIRE(f.out(*p, "g", "out", 63, 3) == Catch::Approx(0.25f));
  // No converter anywhere: every node is global, and the program is one global segment.
  REQUIRE(p->instruments.empty());
  REQUIRE(p->segments.size() == 1);
  REQUIRE(p->segments[0].instrument == -1);
  REQUIRE(p->nodeInstrument == std::vector<int32_t>{-1, -1});
}

TEST_CASE("compile: fan-in sums, unconnected inputs are silent", "[compiler]") {
  GraphFixture f;
  f.node("a", "test.const", {{"value", 0.25f}});
  f.node("b", "test.const", {{"value", 0.5f}});
  f.node("g", "test.gain");
  f.node("lonely", "test.gain");
  f.edge("e1", "a.out", "g.in");
  f.edge("e2", "b.out", "g.in");
  auto p = f.compile();
  f.run(*p, 64);
  REQUIRE(f.out(*p, "g", "out", 0) == Catch::Approx(0.75f));
  REQUIRE(f.out(*p, "lonely", "out", 0) == 0.f);
}

TEST_CASE("compile: implicit param port modulates the knob", "[compiler]") {
  GraphFixture f;
  f.node("in", "test.const", {{"value", 1.f}});
  f.node("mod", "test.const", {{"value", 0.2f}});
  f.node("g", "test.gain", {{"gain", 0.5f}});
  f.edge("e1", "in.out", "g.in");
  f.edge("e2", "mod.out", "g.param:gain");
  auto p = f.compile();
  f.run(*p, 64);
  REQUIRE(f.out(*p, "g", "out", 10) == Catch::Approx(0.9f));   // norm 0.25 + 0.2 -> 0.9
}

TEST_CASE("compile: event ports merge by frame", "[compiler]") {
  GraphFixture f;
  f.node("e1", "test.eventGen", {{"frame", 3.f}, {"tag", 2.f}});
  f.node("e2", "test.eventGen", {{"frame", 3.f}, {"tag", 5.f}});
  f.node("t", "test.eventTrace");
  f.edge("x", "e1.events", "t.events");
  f.edge("y", "e2.events", "t.events");
  auto p = f.compile();
  f.run(*p, 64);
  REQUIRE(f.out(*p, "t", "out", 3) == Catch::Approx(7.f));
}

TEST_CASE("compile: topological order is respected regardless of id order", "[compiler]") {
  GraphFixture f;
  f.node("z_source", "test.const", {{"value", 0.5f}});
  f.node("a_sink", "test.gain");
  f.edge("e", "z_source.out", "a_sink.in");
  auto p = f.compile();
  f.run(*p, 64);
  REQUIRE(f.out(*p, "a_sink", "out", 0) == Catch::Approx(0.5f));
}

TEST_CASE("compile: reuses instances across compiles", "[compiler]") {
  GraphFixture f;
  f.node("c", "test.const", {{"value", 0.5f}});
  f.compile();
  f.node("g", "test.gain");
  auto p2 = f.compile();
  REQUIRE(f.table.size() == 2);
  REQUIRE(p2->instruments.empty());
}

namespace {
/// A chord into a converter, so the fixture has an instrument to put things in.
void addInstrument(GraphFixture& f, const char* pat, const char* poly, float voices, const char* pattern = "[c3,e3,g3]") {
  f.node(pat, "notes.pattern", {{"legato", 1.f}});
  REQUIRE(f.model.setNodeData(pat, nlohmann::json{{"pattern", pattern}}));
  f.node(poly, "note.toPoly", {{"voices", voices}});
  f.edge(std::string(pat) + "_to_" + poly, std::string(pat) + ".notes", std::string(poly) + ".notes");
}
}  // namespace

TEST_CASE("compile: a converter starts an instrument that runs on its own voices", "[compiler]") {
  GraphFixture f;
  pg::registerBuiltinModules(f.reg);
  addInstrument(f, "pat", "poly", 5.f);
  f.node("g", "test.gain");            // per-voice: fed by the converter
  f.node("lfo", "test.const");         // global: feeds the instrument but is not fed by it
  f.node("s", "test.sink");            // the exit
  f.node("after", "test.gain");        // global again: fed only by the exit... which has no output; use the sum
  f.node("sum", "voices.sum");
  f.edge("e1", "poly.gate", "g.in");
  f.edge("e2", "lfo.out", "g.param:gain");
  f.edge("e3", "g.out", "s.in");
  f.edge("e4", "g.out", "sum.in");
  f.edge("e5", "sum.out", "after.in");
  auto p = f.compile();

  REQUIRE(p->instruments.size() == 1);
  REQUIRE(p->instruments[0].voices == 5);
  REQUIRE(p->instruments[0].pairs == 3);   // an odd pool still rounds up to a whole pair
  auto domain = [&](const char* id) {
    for (size_t i = 0; i < p->nodes.size(); ++i) if (p->nodes[i].inst->id == id) return p->nodeInstrument[i];
    throw std::runtime_error(id);
  };
  REQUIRE(domain("pat") == -1);
  REQUIRE(domain("lfo") == -1);
  REQUIRE(domain("poly") == 0);
  REQUIRE(domain("g") == 0);
  REQUIRE(domain("s") == 0);
  REQUIRE(domain("sum") == 0);
  REQUIRE(domain("after") == -1);   // past the sum the signal is global

  // A node is prepared for its own voices: the instrument's, or one when it is global.
  REQUIRE(f.table.find("g")->info.voiceCount == 5);
  REQUIRE(f.table.find("lfo")->info.voiceCount == 1);
  REQUIRE(f.table.find("after")->info.voiceCount == 1);

  // One contiguous instrument segment, headed by its allocation, with the globals either side of it.
  bool sawInstrument = false;
  int instrumentSegments = 0;
  for (const pg::Segment& seg : p->segments) {
    if (seg.instrument == 0) { ++instrumentSegments; REQUIRE(p->ops[seg.firstOp].kind == pg::Op::Allocate); }
    sawInstrument = sawInstrument || seg.instrument == 0;
  }
  REQUIRE(instrumentSegments == 1);
  REQUIRE(p->segments.front().instrument == -1);
  REQUIRE(p->segments.back().instrument == -1);
}

TEST_CASE("compile: two instruments live side by side, each on its own pool", "[compiler]") {
  GraphFixture f;
  pg::registerBuiltinModules(f.reg);
  addInstrument(f, "patA", "polyA", 4.f);
  addInstrument(f, "patB", "polyB", 8.f);
  f.node("gA", "test.gain"); f.node("gB", "test.gain");
  f.node("sumA", "voices.sum"); f.node("sumB", "voices.sum");
  f.node("mix", "test.add");
  f.edge("a1", "polyA.gate", "gA.in"); f.edge("a2", "gA.out", "sumA.in");
  f.edge("b1", "polyB.gate", "gB.in"); f.edge("b2", "gB.out", "sumB.in");
  f.edge("m1", "sumA.out", "mix.a"); f.edge("m2", "sumB.out", "mix.b");
  auto p = f.compile();
  REQUIRE(p->instruments.size() == 2);
  REQUIRE(f.table.find("gA")->info.voiceCount == 4);
  REQUIRE(f.table.find("gB")->info.voiceCount == 8);
  int instrumentSegments = 0;
  for (const pg::Segment& seg : p->segments) instrumentSegments += seg.instrument >= 0 ? 1 : 0;
  REQUIRE(instrumentSegments == 2);
  f.run(*p, 64);
  // Three notes each: the mix sees 3 + 3 gates.
  REQUIRE(f.out(*p, "mix", "out", 63) == Catch::Approx(6.f));
}

TEST_CASE("compile: a summed instrument may feed another, as a global signal", "[compiler]") {
  GraphFixture f;
  pg::registerBuiltinModules(f.reg);
  addInstrument(f, "patA", "polyA", 4.f);
  addInstrument(f, "patB", "polyB", 4.f);
  f.node("sumA", "voices.sum");
  f.node("gB", "test.gain");
  f.node("sumB", "voices.sum");
  f.edge("a1", "polyA.gate", "sumA.in");
  f.edge("b1", "polyB.gate", "gB.in");
  f.edge("b2", "sumA.out", "gB.param:gain");   // A's sum modulates B's voices
  f.edge("b3", "gB.out", "sumB.in");
  auto p = f.compile();
  REQUIRE(p->instruments.size() == 2);
  // A closes before B opens, so B's passes read A's finished sum.
  int seenA = -1, seenB = -1;
  for (size_t i = 0; i < p->segments.size(); ++i) {
    const int32_t inst = p->segments[i].instrument;
    if (inst < 0) continue;
    const bool isA = p->nodes[p->instruments[static_cast<size_t>(inst)].entryNode].inst->id == "polyA";
    if (isA) seenA = static_cast<int>(i); else seenB = static_cast<int>(i);
  }
  REQUIRE(seenA >= 0);
  REQUIRE(seenB > seenA);
  f.run(*p, 64);
}

TEST_CASE("compile: a module two instruments reach is refused, and so is a loop across the edge", "[compiler]") {
  GraphFixture f;
  pg::registerBuiltinModules(f.reg);
  addInstrument(f, "patA", "polyA", 4.f);
  addInstrument(f, "patB", "polyB", 4.f);
  f.node("g", "test.gain");
  f.edge("a", "polyA.gate", "g.in");
  f.edge("b", "polyB.gate", "g.in");
  pg::CompileOutput mixed = pg::compileGraph(f.model, f.reg, f.table, 1, 48000.0, 64);
  REQUIRE(mixed.program == nullptr);
  REQUIRE(mixed.error.find("E_INSTRUMENT_MIX") != std::string::npos);

  GraphFixture g;
  pg::registerBuiltinModules(g.reg);
  addInstrument(g, "pat", "poly", 4.f);
  g.node("v", "test.gain");       // per-voice
  g.node("sum", "voices.sum");
  g.node("back", "test.gain");    // global, fed by the sum, feeding the instrument again: a loop across the edge
  g.edge("e1", "poly.gate", "v.in");
  g.edge("e2", "v.out", "sum.in");
  g.edge("e3", "sum.out", "back.in");
  g.edge("e4", "back.out", "v.param:gain");
  pg::CompileOutput loop = pg::compileGraph(g.model, g.reg, g.table, 1, 48000.0, 64);
  REQUIRE(loop.program == nullptr);
  REQUIRE(loop.error.find("E_FEEDBACK_DOMAIN") != std::string::npos);
}

TEST_CASE("compile: a pool larger than the engine allows is refused", "[compiler]") {
  GraphFixture f;
  pg::registerBuiltinModules(f.reg);
  f.node("pat", "notes.pattern");
  f.node("poly", "note.toPoly");
  f.edge("e", "pat.notes", "poly.notes");
  // The model takes any number; the compiler is what refuses a pool the engine cannot run.
  REQUIRE(f.model.setParam(f.reg, "poly", "voices", static_cast<float>(pg::kMaxVoices + 1)));
  pg::CompileOutput refused = pg::compileGraph(f.model, f.reg, f.table, 1, 48000.0, 64);
  REQUIRE(refused.program == nullptr);
  REQUIRE(refused.error.find("E_VOICES") != std::string::npos);
  REQUIRE(f.model.setParam(f.reg, "poly", "voices", static_cast<float>(pg::kMaxVoices)));
  auto most = f.compile();
  REQUIRE(most->instruments[0].pairs == pg::kMaxVoices / 2);
}

TEST_CASE("compile: rejects fan-in above kMaxPortsPerModule", "[compiler]") {
  GraphFixture f;
  f.node("t", "test.eventTrace");
  for (uint32_t i = 0; i < pg::kMaxPortsPerModule + 1; ++i) {
    f.node("g" + std::to_string(i), "test.eventGen", {{"frame", 3.f}, {"tag", 1.f}});
    f.edge("e" + std::to_string(i), "g" + std::to_string(i) + ".events", "t.events");
  }
  pg::CompileOutput o = pg::compileGraph(f.model, f.reg, f.table, 1, 48000.0, 64);
  REQUIRE(o.program == nullptr);
  REQUIRE(o.error.find("E_FAN_IN") != std::string::npos);
}

TEST_CASE("compile: exactly kMaxPortsPerModule fan-in still compiles", "[compiler]") {
  GraphFixture f;
  f.node("t", "test.eventTrace");
  for (uint32_t i = 0; i < pg::kMaxPortsPerModule; ++i) {
    f.node("g" + std::to_string(i), "test.eventGen", {{"frame", 3.f}, {"tag", 1.f}});
    f.edge("e" + std::to_string(i), "g" + std::to_string(i) + ".events", "t.events");
  }
  auto p = f.compile();
  f.run(*p, 64);
  REQUIRE(f.out(*p, "t", "out", 3) == Catch::Approx(static_cast<float>(pg::kMaxPortsPerModule)));
}

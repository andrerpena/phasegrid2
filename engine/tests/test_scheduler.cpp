#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include "core/InstanceTable.hpp"
#include "core/Program.hpp"
#include "core/Scheduler.hpp"
#include "modules/TestModules.hpp"

static float lane0(const pg::Program& p, uint32_t buf, uint32_t frame) { return pg::lanes::lane(p.buffers[buf].data[frame], 0); }

TEST_CASE("Scheduler runs a hand-built const -> gain program with a modulated param", "[scheduler]") {
  pg::Registry reg; pg::test::registerTestModules(reg);
  pg::InstanceTable table;
  pg::PrepareInfo info{48000.0, pg::kMaxBlockSize, 1};
  pg::Program p;
  p.allocBuffer(); p.allocEventBuffer();
  pg::NodeSlot c; c.inst = table.acquire("c", *reg.find("test.const"), info, {{"value", 0.5f}});
  c.outBuf = {p.allocBuffer()}; c.outEvt = {pg::kNone}; c.paramBuf = {pg::kNone};
  pg::NodeSlot m; m.inst = table.acquire("m", *reg.find("test.const"), info, {{"value", 0.2f}});
  m.outBuf = {p.allocBuffer()}; m.outEvt = {pg::kNone}; m.paramBuf = {pg::kNone};
  pg::NodeSlot g; g.inst = table.acquire("g", *reg.find("test.gain"), info, {{"gain", 0.5f}});
  g.inBuf = {c.outBuf[0]}; g.inEvt = {pg::kNone}; g.outBuf = {p.allocBuffer()}; g.outEvt = {pg::kNone};
  g.paramBuf = {p.allocBuffer()};
  p.nodes = {c, m, g};
  p.ops = { pg::Op{pg::Op::Process, 0}, pg::Op{pg::Op::Process, 1}, pg::Op{pg::Op::FillParam, 2, 0, m.outBuf[0]}, pg::Op{pg::Op::Process, 2} };
  p.buildSerialIndex();
  pg::Scheduler s; pg::TransportSnapshot t;
  s.run(p, 64, t, nullptr);
  // effective gain norm = 0.25 + 0.2 = 0.45 -> 0.9 ; 0.5 * 0.9 = 0.45, on every lane
  REQUIRE(lane0(p, g.outBuf[0], 0) == Catch::Approx(0.45f));
  REQUIRE(pg::lanes::lane(p.buffers[g.outBuf[0]].data[63], 3) == Catch::Approx(0.45f));
}

TEST_CASE("Scheduler sums fan-in and routes events", "[scheduler]") {
  pg::Registry reg; pg::test::registerTestModules(reg);
  pg::InstanceTable table;
  pg::PrepareInfo info{48000.0, pg::kMaxBlockSize, 1};
  pg::Program p;
  p.allocBuffer(); p.allocEventBuffer();
  pg::NodeSlot a; a.inst = table.acquire("a", *reg.find("test.const"), info, {{"value", 0.25f}});
  a.outBuf = {p.allocBuffer()}; a.outEvt = {pg::kNone}; a.paramBuf = {pg::kNone};
  pg::NodeSlot b; b.inst = table.acquire("b", *reg.find("test.const"), info, {{"value", 0.5f}});
  b.outBuf = {p.allocBuffer()}; b.outEvt = {pg::kNone}; b.paramBuf = {pg::kNone};
  const uint32_t sum = p.allocBuffer();
  pg::NodeSlot g; g.inst = table.acquire("g", *reg.find("test.gain"), info, {});
  g.inBuf = {sum}; g.inEvt = {pg::kNone}; g.outBuf = {p.allocBuffer()}; g.outEvt = {pg::kNone}; g.paramBuf = {pg::kNone};
  pg::NodeSlot e1; e1.inst = table.acquire("e1", *reg.find("test.eventGen"), info, {{"frame", 3.f}, {"tag", 2.f}});
  e1.outBuf = {pg::kNone}; e1.outEvt = {p.allocEventBuffer()}; e1.paramBuf = {pg::kNone, pg::kNone};
  pg::NodeSlot e2; e2.inst = table.acquire("e2", *reg.find("test.eventGen"), info, {{"frame", 3.f}, {"tag", 5.f}});
  e2.outBuf = {pg::kNone}; e2.outEvt = {p.allocEventBuffer()}; e2.paramBuf = {pg::kNone, pg::kNone};
  const uint32_t merged = p.allocEventBuffer();
  pg::NodeSlot tr; tr.inst = table.acquire("tr", *reg.find("test.eventTrace"), info, {});
  tr.inBuf = {pg::kNone}; tr.inEvt = {merged}; tr.outBuf = {p.allocBuffer()}; tr.outEvt = {pg::kNone}; tr.paramBuf = {};
  p.nodes = {a, b, g, e1, e2, tr};
  p.args = {a.outBuf[0], b.outBuf[0], e1.outEvt[0], e2.outEvt[0]};
  p.ops = {
    pg::Op{pg::Op::Process, 0}, pg::Op{pg::Op::Process, 1},
    pg::Op{pg::Op::Sum, sum, 0, 2}, pg::Op{pg::Op::Process, 2},
    pg::Op{pg::Op::ClearEvents, e1.outEvt[0]}, pg::Op{pg::Op::Process, 3},
    pg::Op{pg::Op::ClearEvents, e2.outEvt[0]}, pg::Op{pg::Op::Process, 4},
    pg::Op{pg::Op::Merge, merged, 2, 2}, pg::Op{pg::Op::Process, 5},
  };
  p.buildSerialIndex();
  pg::Scheduler s; pg::TransportSnapshot t;
  s.run(p, 64, t, nullptr);
  REQUIRE(lane0(p, g.outBuf[0], 10) == Catch::Approx(0.75f));
  REQUIRE(lane0(p, tr.outBuf[0], 3) == Catch::Approx(7.f));
  REQUIRE(lane0(p, tr.outBuf[0], 2) == 0.f);
  s.run(p, 64, t, nullptr);
  REQUIRE(lane0(p, tr.outBuf[0], 3) == Catch::Approx(7.f));
}

namespace {
/// Records the voice mask the scheduler handed it, so the pair -> mask plumbing is covered without a real module.
struct MaskProbe : pg::VoicedModule<int> {
  static inline pg::Mask seen{};
  void process(pg::ProcessContext& c) override { seen = c.voiceMask; }
};
const pg::PortDesc kProbeOut[] = {{"out", "Out", pg::PortKind::Continuous, 1, pg::SignalRole::Any, ""}};
const pg::ModuleDescriptor kProbe{pg::kModuleAbiVersion, "test.maskProbe", "P", "test", "", nullptr, 0,
                                  kProbeOut, 1, nullptr, 0, 0, 0, []() -> pg::Module* { return new MaskProbe(); }, nullptr, 0};
}  // namespace

TEST_CASE("Scheduler passes a global module voice 0's lanes", "[scheduler]") {
  pg::Registry reg; REQUIRE_FALSE(reg.add(kProbe).has_value());
  pg::InstanceTable table; pg::PrepareInfo info{48000.0, pg::kMaxBlockSize, 1};
  pg::Program p; p.allocBuffer(); p.allocEventBuffer();
  pg::NodeSlot n; n.inst = table.acquire("m", *reg.find("test.maskProbe"), info, {});
  n.outBuf = {p.allocBuffer()}; n.outEvt = {pg::kNone}; n.paramBuf = {};
  p.nodes = {n}; p.ops = {pg::Op{pg::Op::Process, 0}}; p.buildSerialIndex();
  pg::Scheduler s; s.run(p, 64, pg::TransportSnapshot{}, nullptr);
  REQUIRE(pg::lanes::lane(pg::Sample(1.f) & MaskProbe::seen, 0) == 1.f);
  REQUIRE(pg::lanes::lane(pg::Sample(1.f) & MaskProbe::seen, 2) == 0.f);
}

// ------------------------------------------------------------------------------ instruments

#include <nlohmann/json.hpp>
#include "modules/builtin.hpp"
#include "util/GraphFixture.hpp"

namespace {
/// Counts how many times it runs, and which pairs were reset: the two questions live-voice scheduling raises.
struct Counter : pg::VoicedModule<int> {
  static inline int runs = 0;
  static inline std::vector<uint32_t> resets;
  static inline std::vector<std::pair<bool, bool>> passes;   // first, last per run
  void reset(uint32_t pair) override { resets.push_back(pair); }
  void process(pg::ProcessContext& c) override {
    ++runs;
    passes.emplace_back(c.firstPass, c.lastPass);
    const pg::Sample* in = c.in(0).readOr();
    for (uint32_t i = 0; i < c.numFrames; ++i) c.out(0).data[i] = in[i];
  }
  static void clear() { runs = 0; resets.clear(); passes.clear(); }
};
const pg::PortDesc kCounterIn[] = {{"in", "In", pg::PortKind::Continuous, 1, pg::SignalRole::Any, ""}};
const pg::PortDesc kCounterOut[] = {{"out", "Out", pg::PortKind::Continuous, 1, pg::SignalRole::Any, ""}};
const pg::ModuleDescriptor kCounter{pg::kModuleAbiVersion, "test.counter", "Counter", "test", "", kCounterIn, 1,
                                    kCounterOut, 1, nullptr, 0, 0, 0, []() -> pg::Module* { return new Counter(); }, nullptr, 0};

/// pattern -> converter (`voices`) -> counter -> sink. The pattern is a chord held for `legato` of a
/// cycle of two bars -- eight 64-frame blocks at this tempo -- so the voices come and go on block edges.
struct InstrumentRig {
  pg::test::GraphFixture f;
  std::unique_ptr<pg::Program> program;
  InstrumentRig(float voices, const char* pattern, float legato = 1.f) {
    pg::registerBuiltinModules(f.reg);
    REQUIRE_FALSE(f.reg.add(kCounter).has_value());
    Counter::clear();
    f.node("pat", "notes.pattern", {{"legato", legato}, {"cycle", 5.f}});   // two bars: eight blocks per cycle
    REQUIRE(f.model.setNodeData("pat", nlohmann::json{{"pattern", pattern}}));
    f.node("poly", "note.toPoly", {{"voices", voices}});
    f.node("count", "test.counter");
    f.node("s", "test.sink");
    f.edge("e0", "pat.notes", "poly.notes");
    f.edge("e1", "poly.gate", "count.in");
    f.edge("e2", "count.out", "s.in");
    f.transport.tempo = 45000.0;   // one beat is exactly one 64-frame block at 48 kHz
    program = f.compile(48000.0, 64);
  }
  void run(uint64_t at) { f.transport.samplePos = at; f.run(*program, 64); }
};
}  // namespace

TEST_CASE("Scheduler runs a global module once per block and an instrument's module once per live pair", "[scheduler]") {
  // Six notes on a sixteen-voice pool: three live pairs out of eight, so three passes, not eight.
  InstrumentRig rig(16.f, "[c3,e3,g3,bb3,d4,f4]");
  rig.run(0);
  REQUIRE(Counter::runs == 3);
  REQUIRE(Counter::passes.front() == std::pair{true, false});
  REQUIRE(Counter::passes.back() == std::pair{false, true});
  REQUIRE(Counter::passes[1] == std::pair{false, false});
  // The three pairs came alive this block, so each was reset before it ran.
  REQUIRE(Counter::resets == std::vector<uint32_t>{0, 1, 2});
  Counter::clear();
  rig.run(64);
  REQUIRE(Counter::runs == 3);
  REQUIRE(Counter::resets.empty());   // still alive: no reset
}

TEST_CASE("Scheduler leaves a silent instrument entirely alone", "[scheduler]") {
  // A rest: nothing is held, so no pair is live and the per-voice module never runs at all.
  InstrumentRig rig(16.f, "~");
  rig.run(0);
  rig.run(64);
  REQUIRE(Counter::runs == 0);
}

TEST_CASE("Scheduler frees a released voice nobody holds at the end of its block, then resets it on the next note", "[scheduler]") {
  // One note held for an eighth of the cycle: one block, so its gate falls at the start of block 1.
  InstrumentRig rig(4.f, "c3", 0.125f);
  rig.run(0);
  REQUIRE(Counter::runs == 1);
  REQUIRE(Counter::resets == std::vector<uint32_t>{0});
  const pg::VoiceActivity& activity = *rig.program->instruments[0].activity;
  REQUIRE(activity.state(0) == pg::VoiceState::Held);
  // The release lands: the voice is releasing through that block, so its pair still runs and anything
  // that wanted to hold it could. Nothing here does -- the sink only folds -- so it starts its ramp out,
  // and its pair goes on running until that has played.
  rig.run(64);
  REQUIRE(activity.state(0) == pg::VoiceState::Releasing);
  REQUIRE(Counter::runs == 2);
  for (uint32_t block = 2; block < 6; ++block) rig.run(64 * block);
  REQUIRE(activity.state(0) == pg::VoiceState::Free);
  Counter::clear();
  rig.run(64 * 6);
  REQUIRE(Counter::runs == 0);
  // The next cycle's note revives the pair, and the module is reset before it plays.
  Counter::clear();
  rig.run(64 * 8);   // the second cycle's first block
  REQUIRE(Counter::runs == 1);
  REQUIRE(Counter::resets == std::vector<uint32_t>{0});
}

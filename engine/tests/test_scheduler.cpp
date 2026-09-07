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

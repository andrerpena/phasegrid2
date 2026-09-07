#pragma once
#include <stdexcept>
#include <string>
#include "core/GraphCompiler.hpp"
#include "core/InstanceTable.hpp"
#include "core/Scheduler.hpp"
#include "modules/TestModules.hpp"

namespace pg::test {

struct GraphFixture {
  Registry reg;
  GraphModel model;
  InstanceTable table;
  Scheduler scheduler;
  uint64_t revision = 0;
  TransportSnapshot transport;

  GraphFixture() { registerTestModules(reg); }

  void node(const std::string& id, const std::string& type, std::map<std::string, float> params = {}) {
    Result r = model.addNode(reg, NodeModel{id, type, std::move(params)});
    if (!r) throw std::runtime_error(r.message);
  }
  void edge(const std::string& id, const std::string& from, const std::string& to) {   // "node.port"
    auto split = [](const std::string& s) { auto d = s.find('.'); return std::pair{s.substr(0, d), s.substr(d + 1)}; };
    auto [fn, fp] = split(from); auto [tn, tp] = split(to);
    Result r = model.addEdge(reg, EdgeModel{id, fn, fp, tn, tp});
    if (!r) throw std::runtime_error(r.message);
  }
  std::unique_ptr<Program> compile(double sampleRate = 48000.0, uint32_t block = 64) {
    CompileOutput o = compileGraph(model, reg, table, ++revision, sampleRate, block);
    if (!o.program) throw std::runtime_error(o.error);
    return std::move(o.program);
  }
  float out(Program& p, const std::string& nodeId, const std::string& port, uint32_t frame, uint32_t lane = 0) {
    for (const NodeSlot& s : p.nodes)
      if (s.inst->id == nodeId)
        return lanes::lane(p.buffers[s.outBuf[static_cast<size_t>(s.inst->type->findOutput(port))]].data[frame], lane);
    throw std::runtime_error("no node " + nodeId);
  }
  void run(Program& p, uint32_t frames, AudioBus* bus = nullptr) { scheduler.run(p, frames, transport, bus); }
};

}  // namespace pg::test

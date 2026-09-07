#include "core/GraphCompiler.hpp"
#include <algorithm>
#include <functional>
#include <map>
#include <set>

namespace pg {
namespace {

struct EdgeRef {
  const EdgeModel* model;
  uint32_t from, fromPort;   // node index, output index
  uint32_t to, toPort;       // node index, input index (declared + implicit)
  bool back = false;         // set in Task 13
};

struct Tarjan {
  const std::vector<std::vector<uint32_t>>& adj;
  std::vector<int32_t> index, low, comp;
  std::vector<bool> onStack;
  std::vector<uint32_t> stack;
  std::vector<std::vector<uint32_t>> sccs;   // emitted in reverse topological order
  int32_t counter = 0;

  explicit Tarjan(const std::vector<std::vector<uint32_t>>& a)
      : adj(a), index(a.size(), -1), low(a.size(), 0), comp(a.size(), -1), onStack(a.size(), false) {
    for (uint32_t v = 0; v < a.size(); ++v) if (index[v] < 0) visit(v);
  }
  void visit(uint32_t v) {
    index[v] = low[v] = counter++;
    stack.push_back(v); onStack[v] = true;
    for (uint32_t w : adj[v]) {
      if (index[w] < 0) { visit(w); low[v] = std::min(low[v], low[w]); }
      else if (onStack[w]) low[v] = std::min(low[v], index[w]);
    }
    if (low[v] == index[v]) {
      std::vector<uint32_t> scc;
      for (;;) { uint32_t w = stack.back(); stack.pop_back(); onStack[w] = false; comp[w] = static_cast<int32_t>(sccs.size()); scc.push_back(w); if (w == v) break; }
      sccs.push_back(std::move(scc));
    }
  }
};

}  // namespace

CompileOutput compileGraph(const GraphModel& model, const Registry& registry, InstanceTable& instances,
                           uint64_t revision, double sampleRate, uint32_t blockSize) {
  auto fail = [](const std::string& code, const std::string& msg) { return CompileOutput{nullptr, code + ": " + msg}; };
  if (blockSize == 0 || blockSize > kMaxBlockSize) return fail("E_BLOCK", "bad block size");
  if (model.voiceCount > 2) return fail("E_VOICES", "milestone 1 supports at most 2 voices (one pair)");

  // 1. Nodes in id order, resolve types, acquire instances.
  std::vector<const NodeModel*> nodes;
  std::vector<const RegisteredModule*> types;
  std::map<std::string, uint32_t> indexOf;
  for (const auto& [id, n] : model.nodes()) {
    const RegisteredModule* t = registry.find(n.type);
    if (!t) return fail("E_UNKNOWN_TYPE", n.type);
    indexOf[id] = static_cast<uint32_t>(nodes.size());
    nodes.push_back(&n); types.push_back(t);
  }
  const uint32_t N = static_cast<uint32_t>(nodes.size());
  PrepareInfo info{sampleRate, kMaxBlockSize, model.voiceCount};

  // 2. Resolve edges.
  std::vector<EdgeRef> edges;
  for (const auto& [id, e] : model.edges()) {
    EdgeRef r{&e, indexOf.at(e.fromNode), 0, indexOf.at(e.toNode), 0};
    const int32_t op = types[r.from]->findOutput(e.fromPort);
    const int32_t ip = types[r.to]->findInput(e.toPort);
    if (op < 0 || ip < 0) return fail("E_PORT_NOT_FOUND", id);
    r.fromPort = static_cast<uint32_t>(op); r.toPort = static_cast<uint32_t>(ip);
    edges.push_back(r);
  }

  // 3. SCCs in topological order; inside each non-trivial SCC pick a deterministic order and mark back edges.
  std::vector<std::vector<uint32_t>> adj(N);
  for (const EdgeRef& e : edges) adj[e.from].push_back(e.to);
  Tarjan tarjan(adj);
  struct Group { std::vector<uint32_t> nodes; bool cluster = false; };
  std::vector<Group> groups;
  std::vector<uint32_t> pos(N, 0);
  for (auto it = tarjan.sccs.rbegin(); it != tarjan.sccs.rend(); ++it) {
    Group g; g.nodes = *it;
    std::sort(g.nodes.begin(), g.nodes.end());
    bool selfLoop = false;
    for (uint32_t w : adj[g.nodes[0]]) if (g.nodes.size() == 1 && w == g.nodes[0]) selfLoop = true;
    g.cluster = g.nodes.size() > 1 || selfLoop;
    if (g.cluster) {   // DFS from the smallest id following intra-SCC edges gives a stable order
      const int32_t c = tarjan.comp[g.nodes[0]];
      std::vector<uint32_t> ordered; std::vector<bool> seen(N, false);
      std::function<void(uint32_t)> dfs = [&](uint32_t v) {
        seen[v] = true; ordered.push_back(v);
        std::vector<uint32_t> next = adj[v]; std::sort(next.begin(), next.end());
        for (uint32_t w : next) if (tarjan.comp[w] == c && !seen[w]) dfs(w);
      };
      for (uint32_t v : g.nodes) if (!seen[v]) dfs(v);
      g.nodes = ordered;
    }
    for (uint32_t i = 0; i < g.nodes.size(); ++i) pos[g.nodes[i]] = i;
    groups.push_back(std::move(g));
  }
  for (EdgeRef& e : edges) {
    if (tarjan.comp[e.from] != tarjan.comp[e.to]) continue;
    if (pos[e.from] >= pos[e.to]) {
      e.back = true;
      if (types[e.from]->desc->outputs[e.fromPort].kind == PortKind::Event) return fail("E_EVENT_FEEDBACK", e.model->id);
    }
  }

  // 4. Program skeleton and output buffers.
  auto p = std::make_unique<Program>();
  p->revision = revision; p->voiceCount = model.voiceCount; p->voicePairs = (model.voiceCount + 1) / 2;
  for (uint32_t pair = 0; pair < p->voicePairs; ++pair) p->activeVoiceMask.push_back(Program::voiceMaskFor(model.voiceCount, pair));
  p->blockSize = blockSize; p->sampleRate = sampleRate; p->feedbackMode = model.feedbackMode;
  p->allocBuffer();        // kSilentBuffer
  p->allocEventBuffer();   // kEmptyEvents
  p->nodes.resize(N);
  for (uint32_t i = 0; i < N; ++i) {
    NodeSlot& s = p->nodes[i];
    const ModuleDescriptor& d = *types[i]->desc;
    s.inst = instances.acquire(nodes[i]->id, *types[i], info, nodes[i]->params);
    s.inBuf.assign(d.numInputs, kNone); s.inEvt.assign(d.numInputs, kNone);
    s.outBuf.assign(d.numOutputs, kNone); s.outEvt.assign(d.numOutputs, kNone);
    s.paramBuf.assign(d.numParams, kNone);
    for (uint32_t o = 0; o < d.numOutputs; ++o) {
      if (d.outputs[o].kind == PortKind::Continuous) s.outBuf[o] = p->allocBuffer(); else s.outEvt[o] = p->allocEventBuffer();
    }
    for (uint32_t k = 0; k < d.numInputs; ++k)
      if (d.inputs[k].kind == PortKind::Continuous) s.inBuf[k] = kSilentBuffer; else s.inEvt[k] = kEmptyEvents;
  }

  // 5. Feedback states and read buffers per back edge, then per-group emission.
  std::map<size_t, uint32_t> fbIndexOfEdge, fbBufOfEdge;
  for (size_t ei = 0; ei < edges.size(); ++ei) {
    if (!edges[ei].back) continue;
    fbIndexOfEdge[ei] = static_cast<uint32_t>(p->feedback.size());
    p->feedback.push_back(instances.acquireFeedback(edges[ei].model->id));
    fbBufOfEdge[ei] = p->allocBuffer();
  }

  std::string fanInError;
  auto emitNode = [&](uint32_t ni) {
    NodeSlot& s = p->nodes[ni];
    const RegisteredModule& t = *types[ni];
    const ModuleDescriptor& d = *t.desc;
    for (uint32_t ip = 0; ip < t.inputs.size(); ++ip) {
      std::vector<uint32_t> srcs;
      for (size_t ei = 0; ei < edges.size(); ++ei) {
        const EdgeRef& e = edges[ei];
        if (e.to != ni || e.toPort != ip) continue;
        const NodeSlot& src = p->nodes[e.from];
        if (e.back) srcs.push_back(fbBufOfEdge.at(ei));
        else srcs.push_back(t.inputs[ip].kind == PortKind::Continuous ? src.outBuf[e.fromPort] : src.outEvt[e.fromPort]);
      }
      if (srcs.empty()) continue;
      if (srcs.size() > kMaxPortsPerModule) {
        fanInError = nodes[ni]->id + ": more than " + std::to_string(kMaxPortsPerModule) + " connections into one port";
        return;
      }
      const bool continuous = t.inputs[ip].kind == PortKind::Continuous;
      uint32_t result;
      if (srcs.size() == 1) {
        result = srcs[0];
      } else {
        result = continuous ? p->allocBuffer() : p->allocEventBuffer();
        const uint32_t argStart = static_cast<uint32_t>(p->args.size());
        p->args.insert(p->args.end(), srcs.begin(), srcs.end());
        p->ops.push_back(Op{continuous ? Op::Sum : Op::Merge, result, argStart, static_cast<uint32_t>(srcs.size())});
      }
      const int32_t paramIdx = t.inputParam[ip];
      if (paramIdx < 0) { if (continuous) s.inBuf[ip] = result; else s.inEvt[ip] = result; }
      else {
        s.paramBuf[paramIdx] = p->allocBuffer();
        p->ops.push_back(Op{Op::FillParam, ni, static_cast<uint32_t>(paramIdx), result});
      }
    }
    for (uint32_t o = 0; o < d.numOutputs; ++o)
      if (s.outEvt[o] != kNone) p->ops.push_back(Op{Op::ClearEvents, s.outEvt[o]});
    p->ops.push_back(Op{Op::Process, ni});
    for (size_t ei = 0; ei < edges.size(); ++ei)
      if (edges[ei].back && edges[ei].from == ni)
        p->ops.push_back(Op{Op::FeedbackWrite, fbIndexOfEdge.at(ei), p->nodes[ni].outBuf[edges[ei].fromPort]});
  };

  for (const Group& g : groups) {
    if (!g.cluster) {
      emitNode(g.nodes[0]);
      if (!fanInError.empty()) return fail("E_FAN_IN", fanInError);
      continue;
    }
    const size_t beginAt = p->ops.size();
    p->ops.push_back(Op{Op::ClusterBegin, 0});
    for (size_t ei = 0; ei < edges.size(); ++ei)
      if (edges[ei].back && tarjan.comp[edges[ei].to] == tarjan.comp[g.nodes[0]])
        p->ops.push_back(Op{Op::FeedbackRead, fbIndexOfEdge.at(ei), fbBufOfEdge.at(ei)});
    for (uint32_t ni : g.nodes) {
      emitNode(ni);
      if (!fanInError.empty()) return fail("E_FAN_IN", fanInError);
    }
    p->ops[beginAt].a = static_cast<uint32_t>(p->ops.size() - beginAt - 1);
    p->ops.push_back(Op{Op::ClusterEnd});
  }

  p->buildSerialIndex();
  std::set<std::string> liveNodes, liveEdges;
  for (const auto& [id, n] : model.nodes()) liveNodes.insert(id);
  for (const auto& [id, e] : model.edges()) liveEdges.insert(id);
  instances.prune(liveNodes, liveEdges);
  return CompileOutput{std::move(p), ""};
}

}  // namespace pg

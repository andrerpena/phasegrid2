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

  // 3b. Instruments: which nodes run on whose voices.
  //
  // An instrument is everything a continuous signal path reaches from a voice entry's outputs without
  // crossing a voice exit. The exit itself belongs to the instrument (it folds the voices); what comes
  // out of it is global. A node two entries reach is an error rather than a guess, and so is a loop that
  // straddles domains, because a pass over one instrument's pairs cannot also be a pass over another's.
  std::vector<int32_t> nodeInstrument(N, -1);
  std::vector<Instrument> instruments;
  {
    std::vector<std::vector<uint32_t>> contAdj(N);
    for (const EdgeRef& e : edges)
      if (types[e.from]->desc->outputs[e.fromPort].kind == PortKind::Continuous) contAdj[e.from].push_back(e.to);
    for (uint32_t i = 0; i < N; ++i) {
      if (!(types[i]->desc->flags & kModuleVoiceEntry)) continue;
      const int32_t k = static_cast<int32_t>(instruments.size());
      Instrument inst;
      inst.entryNode = i;
      const int32_t voicesParam = types[i]->findParam("voices");
      float voices = 1.f;
      if (voicesParam >= 0) {
        const ParamDesc& d = types[i]->desc->params[voicesParam];
        const auto pv = nodes[i]->params.find(d.id);
        voices = pv == nodes[i]->params.end() ? d.def : pv->second;
      }
      if (!(voices >= 1.f) || voices > static_cast<float>(kMaxVoices))
        return fail("E_VOICES", nodes[i]->id + ": voices must be 1.." + std::to_string(kMaxVoices));
      inst.voices = static_cast<uint32_t>(voices);
      inst.pairs = (inst.voices + 1) / 2;
      instruments.push_back(std::move(inst));
      if (nodeInstrument[i] >= 0) return fail("E_INSTRUMENT_MIX", nodes[i]->id + " is inside another instrument");
      nodeInstrument[i] = k;
      std::vector<uint32_t> stack{i};
      while (!stack.empty()) {
        const uint32_t v = stack.back(); stack.pop_back();
        if (v != i && (types[v]->desc->flags & kModuleVoiceExit)) continue;   // the fold ends the region
        for (uint32_t w : contAdj[v]) {
          if (nodeInstrument[w] == k) continue;
          if (nodeInstrument[w] >= 0 || (types[w]->desc->flags & kModuleVoiceEntry))
            return fail("E_INSTRUMENT_MIX", nodes[w]->id + " is reached by two instruments; sum one of them first");
          nodeInstrument[w] = k;
          stack.push_back(w);
        }
      }
    }
    for (uint32_t i = 0; i < N; ++i)
      if (nodeInstrument[i] >= 0) instruments[static_cast<size_t>(nodeInstrument[i])].nodes.push_back(i);
    for (const Group& g : groups) {
      if (!g.cluster) continue;
      for (uint32_t v : g.nodes)
        if (nodeInstrument[v] != nodeInstrument[g.nodes[0]])
          return fail("E_FEEDBACK_DOMAIN", nodes[v]->id + ": a feedback loop cannot cross an instrument's edge");
    }
  }
  auto pairsOf = [&](uint32_t node) {
    return nodeInstrument[node] < 0 ? 1u : instruments[static_cast<size_t>(nodeInstrument[node])].pairs;
  };
  auto voicesOf = [&](uint32_t node) {
    return nodeInstrument[node] < 0 ? 1u : instruments[static_cast<size_t>(nodeInstrument[node])].voices;
  };

  // 4. Program skeleton and output buffers.
  auto p = std::make_unique<Program>();
  p->revision = revision;
  p->blockSize = blockSize; p->sampleRate = sampleRate; p->feedbackMode = model.feedbackMode;
  p->allocBuffer();        // kSilentBuffer
  p->allocEventBuffer();   // kEmptyEvents
  p->nodes.resize(N);
  p->nodeInstrument = nodeInstrument;
  for (uint32_t i = 0; i < N; ++i) {
    NodeSlot& s = p->nodes[i];
    const ModuleDescriptor& d = *types[i]->desc;
    // A node is prepared for ITS voices: the instrument's, or one when it is global. `acquire`
    // rebuilds a node whose count moved and reuses the rest, so joining an instrument resets only the
    // modules that joined.
    const PrepareInfo info{sampleRate, kMaxBlockSize, voicesOf(i)};
    // NOTE: this mutates the caller's InstanceTable before compilation is known to succeed, and
    // failures still lie ahead (E_FAN_IN below). A commit that fails after this point has already
    // rebuilt any node whose voices changed, and the next successful commit starts it from fresh
    // state. Left as is deliberately; restructuring would mean compiling into a scratch table and
    // merging on success.
    s.inst = instances.acquire(nodes[i]->id, *types[i], info, nodes[i]->params, nodes[i]->data);
    s.inBuf.assign(d.numInputs, kNone); s.inEvt.assign(d.numInputs, kNone);
    s.outBuf.assign(d.numOutputs, kNone); s.outEvt.assign(d.numOutputs, kNone);
    s.paramBuf.assign(d.numParams, kNone);
    for (uint32_t o = 0; o < d.numOutputs; ++o) {
      if (d.outputs[o].kind == PortKind::Continuous) s.outBuf[o] = p->allocBuffer(); else s.outEvt[o] = p->allocEventBuffer();
    }
    for (uint32_t k = 0; k < d.numInputs; ++k)
      if (d.inputs[k].kind == PortKind::Continuous) s.inBuf[k] = kSilentBuffer; else s.inEvt[k] = kEmptyEvents;
  }
  for (Instrument& inst : instruments) inst.activity = instances.acquireActivity(nodes[inst.entryNode]->id, inst.voices);
  p->instruments = instruments;   // a copy: `pairsOf` and `voicesOf` still read the local list below

  // 5. Feedback states and read buffers per back edge, then per-group emission.
  std::map<size_t, uint32_t> fbIndexOfEdge, fbBufOfEdge;
  for (size_t ei = 0; ei < edges.size(); ++ei) {
    if (!edges[ei].back) continue;
    fbIndexOfEdge[ei] = static_cast<uint32_t>(p->feedback.size());
    p->feedback.push_back(instances.acquireFeedback(edges[ei].model->id, pairsOf(edges[ei].from)));
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

  // 6. The order the groups run in. Topological, as before, with one constraint on top: an instrument's
  // groups are emitted as one contiguous run, because its pairs share the program's buffers and a pass
  // must see the whole instrument's work for its own pair. Globals an instrument needs go before it
  // opens (a ready global is always taken first), an instrument that needs another instrument's summed
  // output waits for it to close, and while an instrument is open only its own groups are taken.
  const size_t G = groups.size();
  std::vector<int32_t> groupOf(N);
  for (size_t gi = 0; gi < G; ++gi) for (uint32_t v : groups[gi].nodes) groupOf[v] = static_cast<int32_t>(gi);
  std::vector<int32_t> groupDomain(G);
  for (size_t gi = 0; gi < G; ++gi) groupDomain[gi] = nodeInstrument[groups[gi].nodes[0]];
  std::vector<std::set<size_t>> groupSucc(G), groupPred(G);
  for (const EdgeRef& e : edges) {
    const size_t a = static_cast<size_t>(groupOf[e.from]), b = static_cast<size_t>(groupOf[e.to]);
    if (a == b) continue;
    groupSucc[a].insert(b); groupPred[b].insert(a);
  }
  // Which instruments each instrument needs finished first: any instrument among the ancestors of its groups.
  std::vector<std::set<int32_t>> instrumentDeps(p->instruments.size());
  for (size_t gi = 0; gi < G; ++gi) {
    if (groupDomain[gi] < 0) continue;
    std::vector<size_t> stack{gi};
    std::set<size_t> seen{gi};
    while (!stack.empty()) {
      const size_t g = stack.back(); stack.pop_back();
      for (size_t pr : groupPred[g]) {
        if (!seen.insert(pr).second) continue;
        if (groupDomain[pr] >= 0 && groupDomain[pr] != groupDomain[gi]) instrumentDeps[static_cast<size_t>(groupDomain[gi])].insert(groupDomain[pr]);
        stack.push_back(pr);
      }
    }
  }
  std::vector<size_t> indeg(G);
  for (size_t gi = 0; gi < G; ++gi) indeg[gi] = groupPred[gi].size();
  std::set<size_t> ready;
  for (size_t gi = 0; gi < G; ++gi) if (indeg[gi] == 0) ready.insert(gi);
  std::vector<bool> instrumentDone(p->instruments.size(), false);
  std::vector<size_t> instrumentLeft(p->instruments.size(), 0);
  for (size_t gi = 0; gi < G; ++gi) if (groupDomain[gi] >= 0) ++instrumentLeft[static_cast<size_t>(groupDomain[gi])];
  std::vector<size_t> order;
  int32_t open = -1;
  while (order.size() < G) {
    size_t pick = G;
    if (open >= 0) {
      for (size_t gi : ready) if (groupDomain[gi] == open) { pick = gi; break; }
    } else {
      for (size_t gi : ready) if (groupDomain[gi] < 0) { pick = gi; break; }
      if (pick == G)
        for (size_t gi : ready) {
          const auto& deps = instrumentDeps[static_cast<size_t>(groupDomain[gi])];
          bool waiting = false;
          for (int32_t dep : deps) waiting = waiting || !instrumentDone[static_cast<size_t>(dep)];
          if (!waiting) { pick = gi; break; }
        }
    }
    if (pick == G) return fail("E_INTERNAL", "could not order the instruments");
    ready.erase(pick);
    order.push_back(pick);
    for (size_t nx : groupSucc[pick]) if (--indeg[nx] == 0) ready.insert(nx);
    if (groupDomain[pick] >= 0) {
      open = groupDomain[pick];
      if (--instrumentLeft[static_cast<size_t>(open)] == 0) { instrumentDone[static_cast<size_t>(open)] = true; open = -1; }
    }
  }

  auto beginSegment = [&](int32_t domain) {
    p->segments.push_back(Segment{domain, p->ops.size(), 0});
    if (domain >= 0) p->ops.push_back(Op{Op::Allocate, p->instruments[static_cast<size_t>(domain)].entryNode});
  };
  auto closeSegment = [&]() {
    if (!p->segments.empty()) p->segments.back().count = p->ops.size() - p->segments.back().firstOp;
  };
  for (size_t gi : order) {
    const Group& g = groups[gi];
    const int32_t domain = groupDomain[gi];
    if (p->segments.empty() || p->segments.back().instrument != domain) {
      closeSegment();
      beginSegment(domain);
    }
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
  closeSegment();

  p->buildSerialIndex();
  std::set<std::string> liveNodes, liveEdges;
  for (const auto& [id, n] : model.nodes()) liveNodes.insert(id);
  for (const auto& [id, e] : model.edges()) liveEdges.insert(id);
  instances.prune(liveNodes, liveEdges);
  return CompileOutput{std::move(p), ""};
}

}  // namespace pg

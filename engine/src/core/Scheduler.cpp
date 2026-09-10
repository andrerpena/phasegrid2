#include "core/Scheduler.hpp"

#include "services/Telemetry.hpp"

namespace pg {

static_assert(kMaxParamsPerModule <= kTelemetryMaxParams,
              "a params slot must hold every parameter a module can have");

void Scheduler::run(Program& p, uint32_t numFrames, const TransportSnapshot& t, AudioBus* bus,
                    TelemetryWriter* telemetry) noexcept {
  p.buffers[kSilentBuffer].clear();
  p.eventBufs[kEmptyEvents].clear();
  for (NodeSlot& slot : p.nodes)
    for (ParamState& ps : slot.inst->params) ps.fillRamp(numFrames);
  ++blockIndex_;

  // A program with no segments is one global segment: what a hand-built program in a test is.
  if (p.segments.empty()) {
    const Segment whole{-1, 0, p.ops.size()};
    runSegment(p, whole, numFrames, Pass{}, t, bus, telemetry);
    return;
  }

  for (const Segment& seg : p.segments) {
    if (seg.instrument < 0) {
      runSegment(p, seg, numFrames, Pass{}, t, bus, telemetry);
      continue;
    }
    Instrument& inst = p.instruments[static_cast<size_t>(seg.instrument)];
    VoiceActivity& activity = *inst.activity;

    // The entry decides which voice each of the block's notes goes to, once, before any pass. Its
    // Allocate op sits at the head of the segment and is skipped by the passes.
    for (size_t i = seg.firstOp; i < seg.firstOp + seg.count; ++i) {
      const Op& op = p.ops[i];
      if (op.kind != Op::Allocate) continue;
      Pass allocation;
      allocation.activity = &activity;
      ProcessContext ctx;
      AudioBus busSlice;
      bind(p, p.nodes[op.a], 0, numFrames, allocation, t, bus, telemetry, ctx, busSlice);
      p.nodes[op.a].inst->module->allocate(ctx);
    }

    // Then one pass per live pair, in ascending order, so a module's "first pass" is well defined. A
    // pair that was dead last block and is live now has a new note in it: every module of the
    // instrument is reset for that pair first, so the note starts from clean state.
    uint32_t last = inst.pairs;
    for (uint32_t pair = inst.pairs; pair > 0; --pair)
      if (activity.pairLive(pair - 1)) { last = pair - 1; break; }
    bool first = true;
    for (uint32_t pair = 0; pair < inst.pairs; ++pair) {
      const bool live = activity.pairLive(pair);
      if (live && !activity.ranLastBlock(pair))
        for (uint32_t node : inst.nodes) p.nodes[node].inst->module->reset(pair);
      activity.markRan(pair, live);
      if (!live) continue;
      Pass pass;
      pass.pair = pair;
      pass.mask = activity.laneMask(pair);
      pass.first = first;
      pass.last = pair == last;
      pass.activity = &activity;
      runSegment(p, seg, numFrames, pass, t, bus, telemetry);
      first = false;
    }
    activity.settle();
  }
}

void Scheduler::runSegment(Program& p, const Segment& seg, uint32_t numFrames, const Pass& pass, const TransportSnapshot& t,
                           AudioBus* bus, TelemetryWriter* telemetry) {
  for (size_t i = seg.firstOp; i < seg.firstOp + seg.count; ++i) {
    const Op& op = p.ops[i];
    if (op.kind == Op::ClusterBegin) { runCluster(p, i + 1, op.a, numFrames, pass, t, bus, telemetry); i += op.a + 1; continue; }
    exec(p, op, 0, numFrames, pass, t, bus, telemetry);
  }
}

void Scheduler::runCluster(Program& p, size_t first, uint32_t count, uint32_t numFrames, const Pass& pass, const TransportSnapshot& t, AudioBus* bus,
                           TelemetryWriter* telemetry) {
  if (p.feedbackMode == FeedbackMode::Block) {
    for (uint32_t k = 0; k < count; ++k) exec(p, p.ops[first + k], 0, numFrames, pass, t, bus, telemetry);
    return;
  }
  for (uint32_t s = 0; s < numFrames; ++s)
    for (uint32_t k = 0; k < count; ++k) exec(p, p.ops[first + k], s, 1, pass, t, bus, telemetry);
}

void Scheduler::bind(Program& p, NodeSlot& slot, uint32_t offset, uint32_t n, const Pass& pass, const TransportSnapshot& t, AudioBus* bus,
                     TelemetryWriter* telemetry, ProcessContext& ctx, AudioBus& busSlice) {
  const ModuleDescriptor& d = *slot.inst->type->desc;
  for (uint32_t i = 0; i < d.numInputs; ++i) {
    in_[i] = (slot.inBuf[i] == kNone || slot.inBuf[i] == kSilentBuffer) ? SignalView{} : view(p, slot.inBuf[i], offset, n);   // unconnected -> empty view
    evIn_[i] = slot.inEvt[i] == kNone ? &emptyEvents_ : &p.eventBufs[slot.inEvt[i]];
  }
  for (uint32_t i = 0; i < d.numOutputs; ++i) {
    out_[i] = slot.outBuf[i] == kNone ? SignalView{} : view(p, slot.outBuf[i], offset, n);
    evOut_[i] = slot.outEvt[i] == kNone ? &emptyEvents_ : &p.eventBufs[slot.outEvt[i]];
  }
  for (uint32_t i = 0; i < d.numParams; ++i) {
    const ParamState& ps = slot.inst->params[i];
    const float knob = ps.rampIsConstant ? ps.constValue : ps.rampValue[offset];
    if (slot.paramBuf[i] != kNone) params_[i] = ParamView{p.buffers[slot.paramBuf[i]].data.data() + offset, nullptr, 0.f, knob};
    else if (ps.rampIsConstant) params_[i] = ParamView{nullptr, nullptr, ps.constValue, knob};
    else params_[i] = ParamView{nullptr, ps.rampValue.data() + offset, 0.f, knob};
  }
  if (bus) { busSlice.data = bus->data + offset; busSlice.frames = n; }
  ctx.numFrames = n; ctx.voice = pass.pair; ctx.firstPass = pass.first; ctx.lastPass = pass.last;
  ctx.voiceMask = pass.mask; ctx.activity = pass.activity;
  ctx.sampleRate = p.sampleRate; ctx.transport = &t;
  ctx.telemetry = telemetry;
  ctx.displaySlot = slot.inst->slot(TelemetryChannel::Display);
  ctx.outputBus = bus ? &busSlice : nullptr;
  ctx.inputs = in_.data(); ctx.outputs = out_.data(); ctx.eventInputs = evIn_.data(); ctx.eventOutputs = evOut_.data();
  ctx.params = params_.data();
}

void Scheduler::exec(Program& p, const Op& op, uint32_t offset, uint32_t n, const Pass& pass, const TransportSnapshot& t, AudioBus* bus,
                     TelemetryWriter* telemetry) {
  switch (op.kind) {
    case Op::Sum: {
      Sample* dst = p.buffers[op.a].data.data() + offset;
      for (uint32_t i = 0; i < n; ++i) dst[i] = Sample(0.f);
      for (uint32_t k = 0; k < op.c; ++k) {
        const Sample* src = p.buffers[p.args[op.b + k]].data.data() + offset;
        for (uint32_t i = 0; i < n; ++i) dst[i] += src[i];
      }
      return;
    }
    case Op::Merge: {
      if (offset != 0) return;   // events are merged once per block even inside clusters
      std::array<const EventBuffer*, kMaxPortsPerModule> srcs{};
      for (uint32_t k = 0; k < op.c; ++k) srcs[k] = &p.eventBufs[p.args[op.b + k]];
      mergeEvents(srcs.data(), op.c, p.eventBufs[op.a]);
      return;
    }
    case Op::ClearEvents:
      if (offset == 0) p.eventBufs[op.a].clear();
      return;
    case Op::FillParam: {
      const NodeSlot& slot = p.nodes[op.a];
      const ParamState& ps = slot.inst->params[op.b];
      Sample* dst = p.buffers[slot.paramBuf[op.b]].data.data() + offset;
      const Sample* mod = p.buffers[op.c].data.data() + offset;
      for (uint32_t i = 0; i < n; ++i) {
        const float norm = ps.rampIsConstant ? ps.constNorm : ps.rampNorm[offset + i];
        dst[i] = paramDenormalize(*ps.desc, Sample(norm) + mod[i]);
      }
      return;
    }
    case Op::FeedbackRead: {
      const Sample* z = p.feedback[op.a]->z[pass.pair].data.data();   // one delay slot per voice pair
      Sample* d = p.buffers[op.b].data.data() + offset;
      for (uint32_t i = 0; i < n; ++i) d[i] = z[i];
      return;
    }
    case Op::FeedbackWrite: {
      Sample* z = p.feedback[op.a]->z[pass.pair].data.data();
      const Sample* s = p.buffers[op.b].data.data() + offset;
      for (uint32_t i = 0; i < n; ++i) z[i] = s[i];
      return;
    }
    case Op::Allocate:
      return;   // run once by `run`, ahead of the passes
    case Op::Process: {
      NodeSlot& slot = p.nodes[op.a];
      const ModuleDescriptor& d = *slot.inst->type->desc;
      ProcessContext ctx;
      AudioBus busSlice;
      bind(p, slot, offset, n, pass, t, bus, telemetry, ctx, busSlice);
      slot.inst->module->process(ctx);

      // A watched module records the parameter values it just used, so an interface can draw a knob
      // where modulation actually put it and a picture of what it is playing. Done here, for every
      // module, rather than in each one: the views are already built and no module has to know it is
      // being watched. The first pass is what the face shows, and the last frame is where the block
      // left it; inside a sample-level cluster this runs once per sample, which is correct and merely
      // busier. The values land on the instance for the message thread's preview, and in the module's
      // Params slot for the knobs. That is a different slot from the one a module writes its own picture
      // into, so a module that draws itself has both: the picture never costs it its live knobs.
      if (telemetry == nullptr || !pass.first || d.numParams == 0) return;
      const bool previewed = slot.inst->slot(TelemetryChannel::Preview) != kNoTelemetrySlotCtx;
      const uint32_t paramSlot = slot.inst->slot(TelemetryChannel::Params);
      const bool watched = paramSlot != kNoTelemetrySlotCtx;
      if (previewed || watched) {
        for (uint32_t i = 0; i < d.numParams; ++i) {
          paramValues_[i] = lanes::lane(params_[i].at(n - 1), 0);
          slot.inst->liveValues[i].store(paramValues_[i], std::memory_order_relaxed);
        }
        slot.inst->liveBlock.store(blockIndex_, std::memory_order_relaxed);
        if (watched) telemetry->writeParams(paramSlot, paramValues_.data(), d.numParams, blockIndex_);
      }
      return;
    }
    case Op::ClusterBegin:
    case Op::ClusterEnd:
      return;
  }
}

}  // namespace pg

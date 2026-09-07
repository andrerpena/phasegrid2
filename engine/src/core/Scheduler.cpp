#include "core/Scheduler.hpp"

namespace pg {

void Scheduler::run(Program& p, uint32_t numFrames, const TransportSnapshot& t, AudioBus* bus) noexcept {
  p.buffers[kSilentBuffer].clear();
  p.eventBufs[kEmptyEvents].clear();
  for (NodeSlot& slot : p.nodes)
    for (ParamState& ps : slot.inst->params) ps.fillRamp(numFrames);

  for (uint32_t pair = 0; pair < p.voicePairs; ++pair) {
    for (size_t i = 0; i < p.ops.size(); ++i) {
      const Op& op = p.ops[i];
      if (op.kind == Op::ClusterBegin) { runCluster(p, i + 1, op.a, numFrames, pair, t, bus); i += op.a + 1; continue; }
      exec(p, op, 0, numFrames, pair, t, bus);
    }
  }
}

void Scheduler::runCluster(Program& p, size_t first, uint32_t count, uint32_t numFrames, uint32_t pair, const TransportSnapshot& t, AudioBus* bus) {
  if (p.feedbackMode == FeedbackMode::Block) {
    for (uint32_t k = 0; k < count; ++k) exec(p, p.ops[first + k], 0, numFrames, pair, t, bus);
    return;
  }
  for (uint32_t s = 0; s < numFrames; ++s)
    for (uint32_t k = 0; k < count; ++k) exec(p, p.ops[first + k], s, 1, pair, t, bus);
}

void Scheduler::exec(Program& p, const Op& op, uint32_t offset, uint32_t n, uint32_t pair, const TransportSnapshot& t, AudioBus* bus) {
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
      const FeedbackState& fb = *p.feedback[op.a];
      Sample* d = p.buffers[op.b].data.data() + offset;
      for (uint32_t i = 0; i < n; ++i) d[i] = fb.z[i];
      return;
    }
    case Op::FeedbackWrite: {
      FeedbackState& fb = *p.feedback[op.a];
      const Sample* s = p.buffers[op.b].data.data() + offset;
      for (uint32_t i = 0; i < n; ++i) fb.z[i] = s[i];
      return;
    }
    case Op::Process: {
      NodeSlot& slot = p.nodes[op.a];
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
      AudioBus busSlice;
      if (bus) { busSlice.data = bus->data + offset; busSlice.frames = n; }
      ProcessContext ctx;
      ctx.numFrames = n; ctx.voice = pair; ctx.sampleRate = p.sampleRate; ctx.transport = &t;
      ctx.voiceMask = pair < p.activeVoiceMask.size() ? p.activeVoiceMask[pair] : Mask(static_cast<uint32_t>(-1));
      ctx.outputBus = bus ? &busSlice : nullptr;
      ctx.inputs = in_.data(); ctx.outputs = out_.data(); ctx.eventInputs = evIn_.data(); ctx.eventOutputs = evOut_.data();
      ctx.params = params_.data();
      slot.inst->module->process(ctx);
      return;
    }
    case Op::ClusterBegin:
    case Op::ClusterEnd:
      return;
  }
}

}  // namespace pg

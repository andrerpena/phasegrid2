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

  for (uint32_t pair = 0; pair < p.voicePairs; ++pair) {
    for (size_t i = 0; i < p.ops.size(); ++i) {
      const Op& op = p.ops[i];
      if (op.kind == Op::ClusterBegin) { runCluster(p, i + 1, op.a, numFrames, pair, t, bus, telemetry); i += op.a + 1; continue; }
      exec(p, op, 0, numFrames, pair, t, bus, telemetry);
    }
  }
}

void Scheduler::runCluster(Program& p, size_t first, uint32_t count, uint32_t numFrames, uint32_t pair, const TransportSnapshot& t, AudioBus* bus,
                           TelemetryWriter* telemetry) {
  if (p.feedbackMode == FeedbackMode::Block) {
    for (uint32_t k = 0; k < count; ++k) exec(p, p.ops[first + k], 0, numFrames, pair, t, bus, telemetry);
    return;
  }
  for (uint32_t s = 0; s < numFrames; ++s)
    for (uint32_t k = 0; k < count; ++k) exec(p, p.ops[first + k], s, 1, pair, t, bus, telemetry);
}

void Scheduler::exec(Program& p, const Op& op, uint32_t offset, uint32_t n, uint32_t pair, const TransportSnapshot& t, AudioBus* bus,
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
      const Sample* z = p.feedback[op.a]->z[pair].data.data();   // one delay slot per voice pair
      Sample* d = p.buffers[op.b].data.data() + offset;
      for (uint32_t i = 0; i < n; ++i) d[i] = z[i];
      return;
    }
    case Op::FeedbackWrite: {
      Sample* z = p.feedback[op.a]->z[pair].data.data();
      const Sample* s = p.buffers[op.b].data.data() + offset;
      for (uint32_t i = 0; i < n; ++i) z[i] = s[i];
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
      ctx.numFrames = n; ctx.voice = pair; ctx.voicePairs = p.voicePairs; ctx.sampleRate = p.sampleRate; ctx.transport = &t;
      ctx.telemetry = telemetry;
      ctx.telemetrySlot = slot.inst->telemetrySlot.load(std::memory_order_relaxed);
      ctx.voiceMask = pair < p.activeVoiceMask.size() ? p.activeVoiceMask[pair] : Mask(static_cast<uint32_t>(-1));
      ctx.outputBus = bus ? &busSlice : nullptr;
      ctx.inputs = in_.data(); ctx.outputs = out_.data(); ctx.eventInputs = evIn_.data(); ctx.eventOutputs = evOut_.data();
      ctx.params = params_.data();
      slot.inst->module->process(ctx);

      // A watched module records the parameter values it just used, so an interface can draw a knob
      // where modulation actually put it and a picture of what it is playing. Done here, for every
      // module, rather than in each one: the views are already built and no module has to know it is
      // being watched. Voice 0 is what the face shows, and the last frame is where the block left it;
      // inside a sample-level cluster this runs once per sample, which is correct and merely busier.
      // The values land on the instance for the message thread's preview, and in the Params slot for
      // the knobs; a module that publishes a kind of its own (the displays) keeps its slot for that.
      const bool previewed = slot.inst->previewSlot.load(std::memory_order_relaxed) != kNoTelemetrySlotCtx;
      const bool watched = ctx.telemetrySlot != kNoTelemetrySlotCtx && (d.flags & kModuleWritesTelemetry) == 0;
      if (telemetry != nullptr && pair == 0 && (previewed || watched) && d.numParams > 0) {
        for (uint32_t i = 0; i < d.numParams; ++i) {
          paramValues_[i] = lanes::lane(params_[i].at(n - 1), 0);
          slot.inst->liveValues[i].store(paramValues_[i], std::memory_order_relaxed);
        }
        slot.inst->liveBlock.store(blockIndex_, std::memory_order_relaxed);
        if (watched) telemetry->writeParams(ctx.telemetrySlot, paramValues_.data(), d.numParams, blockIndex_);
      }
      return;
    }
    case Op::ClusterBegin:
    case Op::ClusterEnd:
      return;
  }
}

}  // namespace pg

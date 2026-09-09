#include "core/InstanceTable.hpp"

#include "services/Telemetry.hpp"

namespace pg {

std::shared_ptr<ModuleInstance> InstanceTable::acquire(const std::string& id, const RegisteredModule& type,
                                                       const PrepareInfo& info, const std::map<std::string, float>& params,
                                                       const NodeData& data) {
  if (!(info == lastInfo_)) {
    byId_.clear();   // old instances stay alive through the retired program's shared_ptrs; feedback states may stay
    lastInfo_ = info;
  }
  auto modelValue = [&params](const ParamDesc& d) {
    auto pv = params.find(d.id);
    return pv == params.end() ? d.def : pv->second;
  };

  auto it = byId_.find(id);
  if (it != byId_.end() && it->second->type == &type) {
    // Node data is structural for the same reason a kParamStructural param is: `configure` reads it once,
    // before `prepare`, so the only way to apply a change is to build the instance again.
    bool structuralSame = it->second->nodeData == data;
    for (uint32_t i = 0; i < type.desc->numParams && structuralSame; ++i) {
      const ParamDesc& d = type.desc->params[i];
      if (!(d.flags & kParamStructural)) continue;
      structuralSame = modelValue(d) == it->second->appliedValues[i];
    }
    if (structuralSame) return it->second;
  }

  auto inst = std::make_shared<ModuleInstance>();
  inst->id = id;
  // A telemetry subscription is about the NODE, not the instance that happens to be serving it, so
  // it is carried across a rebuild. Without this, editing a module's structural data silently
  // unsubscribes it: `telemetry.subscribe` only reassigns when the SET of watched modules changes,
  // and an edit does not change that set -- so nothing would ever hand the new instance a slot.
  if (it != byId_.end()) {
    inst->telemetrySlot.store(it->second->telemetrySlot.load(std::memory_order_relaxed),
                              std::memory_order_relaxed);
    inst->previewSlot.store(it->second->previewSlot.load(std::memory_order_relaxed),
                            std::memory_order_relaxed);
  }
  inst->serial = nextSerial_++;
  inst->type = &type;
  {
    CreatingDescriptorScope creating(type.desc);   // generated module types read this to find their own descriptor
    inst->module.reset(type.desc->create());
  }
  inst->params.resize(type.desc->numParams);
  inst->appliedValues.reserve(type.desc->numParams);
  for (uint32_t i = 0; i < type.desc->numParams; ++i) inst->appliedValues.push_back(modelValue(type.desc->params[i]));
  inst->nodeData = data;
  inst->module->configure(params, data);   // structural params and node data take effect here; prepare() may allocate around them
  inst->module->prepare(info);
  for (uint32_t i = 0; i < type.desc->numParams; ++i) {
    const ParamDesc& d = type.desc->params[i];
    inst->params[i].prepare(&d, info.sampleRate, paramNormalize(d, modelValue(d)));
  }
  byId_[id] = inst;
  return inst;
}

std::shared_ptr<FeedbackState> InstanceTable::acquireFeedback(const std::string& edgeId, uint32_t voicePairs) {
  auto it = feedbackById_.find(edgeId);
  if (it != feedbackById_.end() && it->second->z.size() == voicePairs) return it->second;
  auto fb = std::make_shared<FeedbackState>(voicePairs);
  feedbackById_[edgeId] = fb;   // the old state stays alive through any program still holding it
  return fb;
}

void InstanceTable::prune(const std::set<std::string>& liveNodeIds, const std::set<std::string>& liveEdgeIds) {
  for (auto it = byId_.begin(); it != byId_.end();) it = liveNodeIds.contains(it->first) ? std::next(it) : byId_.erase(it);
  for (auto it = feedbackById_.begin(); it != feedbackById_.end();) it = liveEdgeIds.contains(it->first) ? std::next(it) : feedbackById_.erase(it);
}

void InstanceTable::clearTelemetrySlots() {
  for (auto& [id, inst] : byId_) {
    inst->telemetrySlot.store(kNoTelemetrySlot, std::memory_order_relaxed);
    inst->previewSlot.store(kNoTelemetrySlot, std::memory_order_relaxed);
  }
}

const ModuleInstance* InstanceTable::find(const std::string& id) const {
  auto it = byId_.find(id);
  return it == byId_.end() ? nullptr : it->second.get();
}

ModuleInstance* InstanceTable::find(const std::string& id) {
  auto it = byId_.find(id);
  return it == byId_.end() ? nullptr : it->second.get();
}

}  // namespace pg

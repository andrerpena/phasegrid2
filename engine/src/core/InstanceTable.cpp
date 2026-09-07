#include "core/InstanceTable.hpp"

namespace pg {

std::shared_ptr<ModuleInstance> InstanceTable::acquire(const std::string& id, const RegisteredModule& type,
                                                       const PrepareInfo& info, const std::map<std::string, float>& params) {
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
    bool structuralSame = true;
    for (uint32_t i = 0; i < type.desc->numParams && structuralSame; ++i) {
      const ParamDesc& d = type.desc->params[i];
      if (!(d.flags & kParamStructural)) continue;
      structuralSame = modelValue(d) == it->second->structuralValues[i];
    }
    if (structuralSame) return it->second;
  }

  auto inst = std::make_shared<ModuleInstance>();
  inst->id = id;
  inst->serial = nextSerial_++;
  inst->type = &type;
  inst->module.reset(type.desc->create());
  inst->params.resize(type.desc->numParams);
  inst->structuralValues.reserve(type.desc->numParams);
  for (uint32_t i = 0; i < type.desc->numParams; ++i) inst->structuralValues.push_back(modelValue(type.desc->params[i]));
  inst->module->configure(params);   // structural params take effect here; prepare() may allocate around them
  inst->module->prepare(info);
  for (uint32_t i = 0; i < type.desc->numParams; ++i) {
    const ParamDesc& d = type.desc->params[i];
    inst->params[i].prepare(&d, info.sampleRate, paramNormalize(d, modelValue(d)));
  }
  byId_[id] = inst;
  return inst;
}

std::shared_ptr<FeedbackState> InstanceTable::acquireFeedback(const std::string& edgeId) {
  auto it = feedbackById_.find(edgeId);
  if (it != feedbackById_.end()) return it->second;
  auto fb = std::make_shared<FeedbackState>();
  feedbackById_[edgeId] = fb;
  return fb;
}

void InstanceTable::prune(const std::set<std::string>& liveNodeIds, const std::set<std::string>& liveEdgeIds) {
  for (auto it = byId_.begin(); it != byId_.end();) it = liveNodeIds.contains(it->first) ? std::next(it) : byId_.erase(it);
  for (auto it = feedbackById_.begin(); it != feedbackById_.end();) it = liveEdgeIds.contains(it->first) ? std::next(it) : feedbackById_.erase(it);
}

const ModuleInstance* InstanceTable::find(const std::string& id) const {
  auto it = byId_.find(id);
  return it == byId_.end() ? nullptr : it->second.get();
}

}  // namespace pg

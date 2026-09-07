#include "core/InstanceTable.hpp"

namespace pg {

std::shared_ptr<ModuleInstance> InstanceTable::acquire(const std::string& id, const RegisteredModule& type,
                                                       const PrepareInfo& info, const std::map<std::string, float>& params) {
  if (!(info == lastInfo_)) {
    for (auto& [k, inst] : byId_) {
      inst->module->prepare(info);
      for (auto& p : inst->params) p.prepare(p.desc, info.sampleRate, p.target);
    }
    lastInfo_ = info;
  }
  auto it = byId_.find(id);
  if (it != byId_.end() && it->second->type == &type) return it->second;

  auto inst = std::make_shared<ModuleInstance>();
  inst->id = id;
  inst->serial = nextSerial_++;
  inst->type = &type;
  inst->module.reset(type.desc->create());
  inst->module->prepare(info);
  inst->params.resize(type.desc->numParams);
  for (uint32_t i = 0; i < type.desc->numParams; ++i) {
    const ParamDesc& d = type.desc->params[i];
    auto pv = params.find(d.id);
    inst->params[i].prepare(&d, info.sampleRate, paramNormalize(d, pv == params.end() ? d.def : pv->second));
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

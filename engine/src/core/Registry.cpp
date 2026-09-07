#include "core/Registry.hpp"
#include <set>
#include "core/Conventions.hpp"

namespace pg {
namespace {
/// A modulatable param gets an implicit `param:<id>` input port -- unless it is stepped, because a
/// per-sample continuous modulation signal has no meaning for an integer or enum. Registry::add uses
/// this for BOTH the collision check and the port-creation loop; the two must never drift apart, or a
/// module declaring an explicit `param:<id>` input for a stepped param is rejected for colliding with
/// a port that is never created.
bool hasImplicitPort(const ParamDesc& p) {
  return (p.flags & kParamModulatable) && !(p.flags & (kParamInteger | kParamEnum));
}
}  // namespace

int32_t RegisteredModule::findInput(std::string_view id) const {
  for (size_t i = 0; i < inputs.size(); ++i) if (id == inputs[i].id) return static_cast<int32_t>(i);
  return -1;
}
int32_t RegisteredModule::findOutput(std::string_view id) const {
  for (uint32_t i = 0; i < desc->numOutputs; ++i) if (id == desc->outputs[i].id) return static_cast<int32_t>(i);
  return -1;
}
int32_t RegisteredModule::findParam(std::string_view id) const {
  for (uint32_t i = 0; i < desc->numParams; ++i) if (id == desc->params[i].id) return static_cast<int32_t>(i);
  return -1;
}

std::optional<std::string> Registry::add(const ModuleDescriptor& d) {
  const std::string id = d.id ? d.id : "";
  if (id.empty()) return "descriptor has no id";
  if (d.abiVersion != kModuleAbiVersion) return id + ": abi version mismatch";
  if (byId_.contains(id)) return id + ": duplicate module id";
  if (d.numInputs + d.numParams > kMaxPortsPerModule || d.numOutputs > kMaxPortsPerModule) return id + ": too many ports";
  if (d.numParams > kMaxParamsPerModule) return id + ": too many params";
  if (!d.create) return id + ": missing create()";

  std::set<std::string> ids;
  for (uint32_t i = 0; i < d.numInputs; ++i)
    if (!ids.insert(d.inputs[i].id).second) return id + ": duplicate input id " + d.inputs[i].id;
  ids.clear();
  for (uint32_t i = 0; i < d.numOutputs; ++i)
    if (!ids.insert(d.outputs[i].id).second) return id + ": duplicate output id " + d.outputs[i].id;
  ids.clear();
  for (uint32_t i = 0; i < d.numParams; ++i) {
    const ParamDesc& p = d.params[i];
    if (!ids.insert(p.id).second) return id + ": duplicate param id " + p.id;
    if (!(p.min < p.max)) return id + ": param " + p.id + " needs min < max";
    if (p.curve == ParamCurve::Log && p.min <= 0.f) return id + ": log param " + p.id + " needs min > 0";
    if ((p.flags & kParamEnum) && (p.enumLabels == nullptr || p.enumCount == 0)) return id + ": enum param " + p.id + " has no labels";
    if (hasImplicitPort(p)) {
      const std::string implicitId = "param:" + std::string(p.id);
      for (uint32_t k = 0; k < d.numInputs; ++k) if (implicitId == d.inputs[k].id) return id + ": input collides with implicit port " + implicitId;
    }
  }

  auto rm = std::make_unique<RegisteredModule>();
  rm->desc = &d;
  for (uint32_t i = 0; i < d.numInputs; ++i) { rm->inputs.push_back(d.inputs[i]); rm->inputParam.push_back(-1); }
  for (uint32_t i = 0; i < d.numParams; ++i) {
    const ParamDesc& p = d.params[i];
    if (!hasImplicitPort(p)) continue;
    rm->implicitIds.push_back("param:" + std::string(p.id));
    rm->inputs.push_back(PortDesc{rm->implicitIds.back().c_str(), p.name, PortKind::Continuous, 1, SignalRole::Cv, p.doc});
    rm->inputParam.push_back(static_cast<int32_t>(i));
  }
  byId_.emplace(id, std::move(rm));
  return std::nullopt;
}

const RegisteredModule* Registry::find(std::string_view typeId) const {
  auto it = byId_.find(typeId);
  return it == byId_.end() ? nullptr : it->second.get();
}

std::vector<const RegisteredModule*> Registry::all() const {
  std::vector<const RegisteredModule*> out;
  for (const auto& [k, v] : byId_) out.push_back(v.get());
  return out;
}

}  // namespace pg

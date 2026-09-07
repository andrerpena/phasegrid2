#pragma once
#include <map>
#include <memory>
#include <set>
#include <string>
#include "core/Program.hpp"

namespace pg {

/// Keeps module instances alive across compiles so hot-swaps preserve DSP state. Message thread only.
class InstanceTable {
public:
  /// Reuses the instance when the type is unchanged; otherwise creates and prepares a new one.
  /// Params are applied only to newly created instances (live ones change through the param queue).
  std::shared_ptr<ModuleInstance> acquire(const std::string& id, const RegisteredModule& type,
                                          const PrepareInfo& info, const std::map<std::string, float>& params);
  std::shared_ptr<FeedbackState> acquireFeedback(const std::string& edgeId);
  void prune(const std::set<std::string>& liveNodeIds, const std::set<std::string>& liveEdgeIds);
  const ModuleInstance* find(const std::string& id) const;
  size_t size() const { return byId_.size(); }
private:
  std::map<std::string, std::shared_ptr<ModuleInstance>> byId_;
  std::map<std::string, std::shared_ptr<FeedbackState>> feedbackById_;
  PrepareInfo lastInfo_{};
  uint64_t nextSerial_ = 1;
};

}  // namespace pg

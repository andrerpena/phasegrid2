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
  /// A change of sample rate, block size or voice count creates fresh instances (DSP state resets);
  /// reuse only happens while PrepareInfo is unchanged.
  ///
  /// `params` is applied at creation ONLY. A reused instance keeps the values it already has, so a
  /// `NodeModel::params` change that reaches the model by any route other than `Engine::setParam`
  /// (today: `loadPatchJson`, which writes straight into the `GraphModel`) leaves the model ahead of
  /// the engine for every node whose `(id, type)` survived the compile.
  ///
  /// This is deliberate and must stay that way: `ParamState` is owned by the audio thread once
  /// `prepare` has run — the param drain calls `setTargetNorm` on it every block — so the message
  /// thread must never write it. Calling `setTargetNorm` from here would be a data race, not a fix.
  /// Any future path that loads a patch into a *live* engine has to diff against a message-thread
  /// "last applied" snapshot and push each changed value through `Engine::setParam` (the queue).
  /// No such path exists yet: `--render` builds a fresh Engine per patch.
  ///
  /// `data` is `NodeModel::data`, and unlike `params` it IS diffed: it is structural, so a change to it
  /// builds a fresh instance rather than leaving the model ahead of the engine.
  std::shared_ptr<ModuleInstance> acquire(const std::string& id, const RegisteredModule& type,
                                          const PrepareInfo& info, const std::map<std::string, float>& params,
                                          const NodeData& data = NodeData::object());
  /// One state per back edge, holding one delay slot per voice pair. Reused across compiles so a
  /// hot-swap keeps the loop running; a change of voice count makes a fresh one instead of resizing the
  /// live one, because the audio thread may still be reading the program that holds it.
  std::shared_ptr<FeedbackState> acquireFeedback(const std::string& edgeId, uint32_t voicePairs);
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

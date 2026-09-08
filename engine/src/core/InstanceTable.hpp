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
  /// `params` is applied here at creation ONLY. A reused instance keeps the values it already has,
  /// and this is deliberate: `ParamState` is owned by the audio thread once `prepare` has run — the
  /// param drain calls `setTargetNorm` on it every block — so the message thread must never write it.
  /// Calling `setTargetNorm` from here would be a data race, not a fix.
  ///
  /// A `NodeModel::params` change that reaches the model by any route other than `Engine::setParam`
  /// (`patch.batch`, `patch.load`, `loadPatchJson`) is instead reconciled by `Engine::commit`, which
  /// diffs the model against `ModuleInstance::appliedValues` after every compile and pushes each
  /// changed value through the param queue, the same way a knob does.
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
  ModuleInstance* find(const std::string& id);
  /// Stops every module publishing telemetry, pictures included. Message thread; the audio thread reads
  /// these atomically.
  void clearTelemetrySlots();
  /// Every live instance, for the message thread's own passes over them (the preview publisher).
  template <class F>
  void forEach(F&& f) {
    for (auto& [id, inst] : byId_) f(*inst);
  }
  size_t size() const { return byId_.size(); }
private:
  std::map<std::string, std::shared_ptr<ModuleInstance>> byId_;
  std::map<std::string, std::shared_ptr<FeedbackState>> feedbackById_;
  PrepareInfo lastInfo_{};
  uint64_t nextSerial_ = 1;
};

}  // namespace pg

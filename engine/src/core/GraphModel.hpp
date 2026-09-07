#pragma once
#include <cstdint>
#include <map>
#include <nlohmann/json.hpp>
#include <string>
#include "core/Module.hpp"
#include "core/Registry.hpp"
#include "core/Result.hpp"

namespace pg {

enum class FeedbackMode { Sample, Block };

/// `data` is arbitrary structured state the module owns and no param can express (see `NodeData`). It is
/// STRUCTURAL: `InstanceTable::acquire` rebuilds the instance when it changes, exactly as it does for a
/// `kParamStructural` param, because it is only ever read by `configure`, before `prepare`.
struct NodeModel {
  std::string id;
  std::string type;
  std::map<std::string, float> params;
  NodeData data = NodeData::object();
};
struct EdgeModel { std::string id; std::string fromNode, fromPort, toNode, toPort; };

/// Engine-side mirror of the frontend's patch document. Message thread only.
class GraphModel {
public:
  Result addNode(const Registry& reg, NodeModel node);
  Result removeNode(const std::string& id);
  Result addEdge(const Registry& reg, EdgeModel edge);
  Result removeEdge(const std::string& id);
  Result setParam(const Registry& reg, const std::string& node, const std::string& param, float value);
  /// Replaces a node's structured data. Must be a JSON object; the next compile rebuilds that instance.
  Result setNodeData(const std::string& node, NodeData data);
  Result setVoiceCount(uint32_t n);
  void clear();
  const std::map<std::string, NodeModel>& nodes() const { return nodes_; }
  const std::map<std::string, EdgeModel>& edges() const { return edges_; }
  uint32_t voiceCount = 1;
  FeedbackMode feedbackMode = FeedbackMode::Sample;
private:
  std::map<std::string, NodeModel> nodes_;
  std::map<std::string, EdgeModel> edges_;
};

}  // namespace pg

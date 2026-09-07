#include "core/GraphModel.hpp"
#include <iterator>

namespace pg {

Result GraphModel::addNode(const Registry& reg, NodeModel node) {
  if (nodes_.contains(node.id)) return Result::fail("E_DUP_ID", "node exists: " + node.id);
  const RegisteredModule* type = reg.find(node.type);
  if (!type) return Result::fail("E_UNKNOWN_TYPE", "unknown module type: " + node.type);
  for (const auto& [k, v] : node.params)
    if (type->findParam(k) < 0) return Result::fail("E_PARAM_NOT_FOUND", node.type + " has no param " + k);
  nodes_.emplace(node.id, std::move(node));
  return {};
}

Result GraphModel::removeNode(const std::string& id) {
  if (!nodes_.erase(id)) return Result::fail("E_NODE_NOT_FOUND", "no node " + id);
  for (auto it = edges_.begin(); it != edges_.end();)
    it = (it->second.fromNode == id || it->second.toNode == id) ? edges_.erase(it) : std::next(it);
  return {};
}

Result GraphModel::addEdge(const Registry& reg, EdgeModel e) {
  if (edges_.contains(e.id)) return Result::fail("E_DUP_ID", "edge exists: " + e.id);
  auto from = nodes_.find(e.fromNode);
  if (from == nodes_.end()) return Result::fail("E_NODE_NOT_FOUND", "no node " + e.fromNode);
  auto to = nodes_.find(e.toNode);
  if (to == nodes_.end()) return Result::fail("E_NODE_NOT_FOUND", "no node " + e.toNode);
  const RegisteredModule* ft = reg.find(from->second.type);
  const RegisteredModule* tt = reg.find(to->second.type);
  const int32_t op = ft->findOutput(e.fromPort);
  if (op < 0) return Result::fail("E_PORT_NOT_FOUND", e.fromNode + " has no output " + e.fromPort);
  const int32_t ip = tt->findInput(e.toPort);
  if (ip < 0) return Result::fail("E_PORT_NOT_FOUND", e.toNode + " has no input " + e.toPort);
  if (ft->desc->outputs[op].kind != tt->inputs[ip].kind) return Result::fail("E_KIND_MISMATCH", "port kinds differ");
  for (const auto& [k, other] : edges_)
    if (other.fromNode == e.fromNode && other.fromPort == e.fromPort && other.toNode == e.toNode && other.toPort == e.toPort)
      return Result::fail("E_DUP_EDGE", "connection already exists: " + k);
  edges_.emplace(e.id, std::move(e));
  return {};
}

Result GraphModel::removeEdge(const std::string& id) {
  if (!edges_.erase(id)) return Result::fail("E_EDGE_NOT_FOUND", "no edge " + id);
  return {};
}

Result GraphModel::setParam(const Registry& reg, const std::string& node, const std::string& param, float value) {
  auto it = nodes_.find(node);
  if (it == nodes_.end()) return Result::fail("E_NODE_NOT_FOUND", "no node " + node);
  if (reg.find(it->second.type)->findParam(param) < 0) return Result::fail("E_PARAM_NOT_FOUND", node + " has no param " + param);
  it->second.params[param] = value;
  return {};
}

Result GraphModel::setVoiceCount(uint32_t n) {
  if (n < 1 || n > 64) return Result::fail("E_VOICES", "voiceCount must be 1..64");
  voiceCount = n;
  return {};
}

void GraphModel::clear() { nodes_.clear(); edges_.clear(); voiceCount = 1; feedbackMode = FeedbackMode::Sample; }

}  // namespace pg

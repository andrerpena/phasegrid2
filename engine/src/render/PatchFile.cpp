#include "render/PatchFile.hpp"
#include <fstream>

namespace pg {
namespace {

Result loadPatchJsonUnguarded(const nlohmann::json& j, const Registry& registry, GraphModel& model) {
  if (!j.is_object() || j.value("schemaVersion", 0) != 1) return Result::fail("E_SCHEMA", "unsupported schemaVersion");
  GraphModel fresh;
  if (Result r = fresh.setVoiceCount(j.value("voiceCount", 1u)); !r) return r;
  const std::string mode = j.value("feedbackMode", "sample");
  if (mode != "sample" && mode != "block") return Result::fail("E_SCHEMA", "feedbackMode must be sample|block");
  fresh.feedbackMode = mode == "block" ? FeedbackMode::Block : FeedbackMode::Sample;
  const nlohmann::json modules = j.value("modules", nlohmann::json::array());
  if (!modules.is_array()) return Result::fail("E_SCHEMA", "modules must be an array");
  for (const auto& m : modules) {
    if (!m.is_object()) return Result::fail("E_SCHEMA", "modules[] entries must be objects");
    NodeModel n;
    n.id = m.value("id", ""); n.type = m.value("type", "");
    if (n.id.empty() || n.type.empty()) return Result::fail("E_SCHEMA", "module needs id and type");
    // Materialize into a named local before iterating: binding a range-based for directly to
    // `.items()` on the unnamed temporary from `.value(...)` leaves the iteration_proxy pointing
    // at a temporary destroyed before the loop body runs (only the proxy itself is lifetime-extended).
    const nlohmann::json params = m.value("params", nlohmann::json::object());
    if (!params.is_object()) return Result::fail("E_SCHEMA", "module " + n.id + ": params must be an object");
    for (const auto& [k, v] : params.items()) {
      if (!v.is_number()) return Result::fail("E_SCHEMA", "param " + k + " must be a number");
      n.params[k] = v.get<float>();
    }
    if (Result r = fresh.addNode(registry, std::move(n)); !r) return r;
  }
  const nlohmann::json edges = j.value("edges", nlohmann::json::array());
  if (!edges.is_array()) return Result::fail("E_SCHEMA", "edges must be an array");
  for (const auto& e : edges) {
    if (!e.is_object()) return Result::fail("E_SCHEMA", "edges[] entries must be objects");
    EdgeModel edge;
    edge.id = e.value("id", "");
    if (edge.id.empty()) return Result::fail("E_SCHEMA", "edge needs id");
    const auto from = e.value("from", nlohmann::json::object()), to = e.value("to", nlohmann::json::object());
    if (!from.is_object() || !to.is_object()) return Result::fail("E_SCHEMA", "edge " + edge.id + ": from and to must be objects");
    edge.fromNode = from.value("module", ""); edge.fromPort = from.value("port", "");
    edge.toNode = to.value("module", ""); edge.toPort = to.value("port", "");
    if (Result r = fresh.addEdge(registry, std::move(edge)); !r) return r;
  }
  model = std::move(fresh);
  return {};
}

}  // namespace

Result loadPatchJson(const nlohmann::json& j, const Registry& registry, GraphModel& model) {
  // Every nlohmann accessor below can throw on an unexpected node type (type_error.302/.306). The
  // explicit is_object()/is_array() guards cover the shapes a user actually hits with a good message;
  // this catch is the backstop so a malformed patch can never take down the engine process, which
  // will load patches straight from IPC.
  try {
    return loadPatchJsonUnguarded(j, registry, model);
  } catch (const nlohmann::json::exception& e) {
    return Result::fail("E_SCHEMA", e.what());
  }
}

Result loadPatchFile(const std::string& path, const Registry& registry, GraphModel& model) {
  std::ifstream in(path);
  if (!in) return Result::fail("E_IO", "cannot open " + path);
  nlohmann::json j = nlohmann::json::parse(in, nullptr, false);
  if (j.is_discarded()) return Result::fail("E_SCHEMA", "invalid JSON in " + path);
  return loadPatchJson(j, registry, model);
}

}  // namespace pg

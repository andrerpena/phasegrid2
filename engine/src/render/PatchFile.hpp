#pragma once
#include <nlohmann/json.hpp>
#include <string>
#include "core/GraphModel.hpp"
namespace pg {
Result loadPatchJson(const nlohmann::json& j, const Registry& registry, GraphModel& model);
Result loadPatchFile(const std::string& path, const Registry& registry, GraphModel& model);
/// The document `loadPatchJson` would read back as this model. `nodes()` and `edges()` are keyed maps, so
/// the arrays come out in id order and the document is stable for a given model.
nlohmann::json savePatchJson(const GraphModel& model);
}

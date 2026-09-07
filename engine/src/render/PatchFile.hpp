#pragma once
#include <nlohmann/json.hpp>
#include <string>
#include "core/GraphModel.hpp"
namespace pg {
Result loadPatchJson(const nlohmann::json& j, const Registry& registry, GraphModel& model);
Result loadPatchFile(const std::string& path, const Registry& registry, GraphModel& model);
}

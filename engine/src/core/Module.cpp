#include "core/Module.hpp"

#include <nlohmann/json.hpp>

namespace pg {

std::string textProperty(const NodeData& data, const char* key, const char* fallback) {
  const std::string missing = fallback == nullptr ? std::string() : std::string(fallback);
  if (!data.is_object()) return missing;
  const auto it = data.find(key);
  if (it == data.end() || !it->is_string()) return missing;
  const std::string& value = it->get_ref<const std::string&>();
  if (value.size() > kMaxTextLength) return missing;
  return value;
}

}  // namespace pg

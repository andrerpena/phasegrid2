#pragma once
#include <nlohmann/json.hpp>
#include "core/Registry.hpp"

namespace pg {

/// Everything the user interface needs to draw a module it has never heard of: every registered module's
/// ports, params, ranges, units and enum labels, plus the engine-wide conventions a patch is written in.
/// Modules are sorted by id and params keep their descriptor order, so the document is byte-stable for a
/// given registry -- which is what makes `catalogHash` meaningful as a cache key.
///
/// Message thread only (it allocates). The engine prints it with `--catalog`.
nlohmann::json catalogJson(const Registry& registry);

}  // namespace pg

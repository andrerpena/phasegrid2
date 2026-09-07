#pragma once
#include "core/Registry.hpp"
namespace pg {
/// Registers every built-in module. Add one line per new module file.
void registerBuiltinModules(Registry& registry);
}

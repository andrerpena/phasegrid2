#include "modules/builtin.hpp"
#include <stdexcept>

namespace pg {
namespace modules { extern const ModuleDescriptor kAudioOut; }

void registerBuiltinModules(Registry& r) {
  const ModuleDescriptor* all[] = { &modules::kAudioOut };
  for (const ModuleDescriptor* d : all)
    if (auto err = r.add(*d)) throw std::runtime_error("registerBuiltinModules: " + *err);
}
}  // namespace pg

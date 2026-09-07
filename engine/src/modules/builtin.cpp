#include "modules/builtin.hpp"
#include <stdexcept>

namespace pg {
namespace modules {
extern const ModuleDescriptor kAudioOut;
const ModuleDescriptor& filterMulti();   // generated at first call; process lifetime
const ModuleDescriptor& oscWavetable();
}  // namespace modules

void registerBuiltinModules(Registry& r) {
  const ModuleDescriptor* all[] = { &modules::kAudioOut, &modules::filterMulti(), &modules::oscWavetable() };
  for (const ModuleDescriptor* d : all)
    if (auto err = r.add(*d)) throw std::runtime_error("registerBuiltinModules: " + *err);
}
}  // namespace pg

#include "modules/builtin.hpp"
#include <stdexcept>

namespace pg {
namespace modules {
extern const ModuleDescriptor kAudioOut;
extern const ModuleDescriptor kNoteToCv;
const ModuleDescriptor& filterMulti();   // generated at first call; process lifetime
const ModuleDescriptor& oscWavetable();
const ModuleDescriptor& envDahdsr();
const ModuleDescriptor& modLfo();
const ModuleDescriptor& modRandom();
}  // namespace modules

void registerBuiltinModules(Registry& r) {
  const ModuleDescriptor* all[] = {
    &modules::kAudioOut, &modules::kNoteToCv,
    &modules::filterMulti(), &modules::oscWavetable(), &modules::envDahdsr(),
    &modules::modLfo(), &modules::modRandom(),
  };
  for (const ModuleDescriptor* d : all)
    if (auto err = r.add(*d)) throw std::runtime_error("registerBuiltinModules: " + *err);
}
}  // namespace pg

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
const ModuleDescriptor& fxReverb();
const ModuleDescriptor& fxDelay();
const ModuleDescriptor& fxChorus();
const ModuleDescriptor& fxFlanger();
const ModuleDescriptor& fxPhaser();
const ModuleDescriptor& fxDistortion();
const ModuleDescriptor& fxCompressor();
const ModuleDescriptor& fxEq();
const ModuleDescriptor& samplerPlayer();
}  // namespace modules

void registerBuiltinModules(Registry& r) {
  const ModuleDescriptor* all[] = {
    &modules::kAudioOut, &modules::kNoteToCv,
    &modules::filterMulti(), &modules::oscWavetable(), &modules::envDahdsr(),
    &modules::modLfo(), &modules::modRandom(),
    &modules::fxReverb(), &modules::fxDelay(), &modules::fxChorus(), &modules::fxFlanger(),
    &modules::fxPhaser(), &modules::fxDistortion(), &modules::fxCompressor(), &modules::fxEq(),
    &modules::samplerPlayer(),
  };
  for (const ModuleDescriptor* d : all)
    if (auto err = r.add(*d)) throw std::runtime_error("registerBuiltinModules: " + *err);
}
}  // namespace pg

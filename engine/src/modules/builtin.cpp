#include "modules/builtin.hpp"
#include <stdexcept>

namespace pg {
namespace modules {
extern const ModuleDescriptor kAudioOut;
extern const ModuleDescriptor kNoteToCv;
extern const ModuleDescriptor kNoteToPoly;
extern const ModuleDescriptor kNotesClip;
extern const ModuleDescriptor kNotesPattern;
extern const ModuleDescriptor kPhaseClock;
extern const ModuleDescriptor kOscSawtooth;
extern const ModuleDescriptor kOscPulse;
extern const ModuleDescriptor kOscSine;
extern const ModuleDescriptor kModLfo;
extern const ModuleDescriptor kScaleOffset;
extern const ModuleDescriptor kMixer;
extern const ModuleDescriptor kVca;
extern const ModuleDescriptor kMeter;
extern const ModuleDescriptor kScope;
extern const ModuleDescriptor kValue;
extern const ModuleDescriptor kPiano;
extern const ModuleDescriptor kVoiceSum;
extern const ModuleDescriptor kEnvAdsr;
const ModuleDescriptor& filterMulti();   // generated at first call; process lifetime
const ModuleDescriptor& oscWavetable();
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
const ModuleDescriptor& noteFxChord();
const ModuleDescriptor& noteFxQuantize();
const ModuleDescriptor& noteFxArp();
const ModuleDescriptor& noteFxHumanize();
}  // namespace modules

void registerBuiltinModules(Registry& r) {
  const ModuleDescriptor* all[] = {
    &modules::kAudioOut, &modules::kNoteToCv, &modules::kNoteToPoly, &modules::kNotesClip, &modules::kNotesPattern,
    &modules::kPhaseClock, &modules::kOscSawtooth, &modules::kOscPulse, &modules::kOscSine, &modules::kModLfo, &modules::kScaleOffset, &modules::kMixer, &modules::kVca,
    &modules::kMeter, &modules::kScope, &modules::kValue, &modules::kPiano, &modules::kVoiceSum,
    &modules::kEnvAdsr,
    &modules::filterMulti(), &modules::oscWavetable(),
    &modules::modRandom(),
    &modules::fxReverb(), &modules::fxDelay(), &modules::fxChorus(), &modules::fxFlanger(),
    &modules::fxPhaser(), &modules::fxDistortion(), &modules::fxCompressor(), &modules::fxEq(),
    &modules::samplerPlayer(),
    &modules::noteFxChord(), &modules::noteFxQuantize(), &modules::noteFxArp(), &modules::noteFxHumanize(),
  };
  for (const ModuleDescriptor* d : all)
    if (auto err = r.add(*d)) throw std::runtime_error("registerBuiltinModules: " + *err);
}
}  // namespace pg

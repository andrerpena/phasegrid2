#include "sst/Descriptors.hpp"
#include "sst/effects/Bonsai.h"

namespace pg::modules {

/// `fx.bonsai` -- a tape saturator: bass boost, saturation, tape noise and a dulled top end.
const ModuleDescriptor& fxBonsai() {
  static const ModuleDescriptor& desc = []() -> const ModuleDescriptor& {
    sstfx::EffectSpec spec = sstfx::effectSpec<sst::effects::bonsai::Bonsai<sstfx::Config>>(
      "fx.bonsai", "Bonsai",
      "Tape. It boosts the bass, saturates, adds the noise a tape has and dulls the top, and each of "
      "those is its own control.");
    spec.face = {"gain", "distort", "dull", "mix"};
    return sstfx::buildDescriptor(spec);
  }();
  return desc;
}

}  // namespace pg::modules

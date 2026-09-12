#pragma once
#include <functional>
#include <memory>
#include <string>
#include <vector>
#include "core/Descriptor.hpp"
#include "core/Module.hpp"
#include "sst/Config.hpp"
#include "sst/basic-blocks/params/ParamMetadata.h"

/**
 * Adapter layer over the Surge Synth Team effect library: it turns one `sst::effects::*` template
 * into a phasegrid `Module`, with the descriptor generated from the effect's own parameter
 * metadata. Nothing here is specific to a single effect; a concrete one is an `EffectSpec` value.
 *
 * This is the same shape as `engine/src/vital/Descriptors.hpp`, and deliberately so -- that layer
 * solved this problem once already. The one difference is the part that matters: an sst effect
 * describes its parameters with `sst::basic_blocks::params::ParamMetaData`, which carries the real
 * unit, the real range and the display scaling. A Vital control carries a raw pre-scale number and a
 * unit label that is often a lie (docs/engine.md), which is what forced `env.adsr` and the old
 * hand-written reverb to declare their parameters by hand. Here the generated descriptor is right.
 */
namespace pg::sstfx {

using ParamMeta = sst::basic_blocks::params::ParamMetaData;

/**
 * One live effect, with its concrete type erased.
 *
 * The effects are templates, so a registry that holds many of them needs a common handle. `Holder`
 * below is the only implementation; it keeps the effect and the three storage objects it was
 * constructed against together, because the effect holds pointers into them for its whole life.
 */
struct Instance {
  virtual ~Instance() = default;
  virtual int numParams() const = 0;
  virtual ParamMeta paramAt(int index) const = 0;
  virtual void initialize() = 0;
  virtual void onSampleRateChanged() = 0;
  virtual void processBlock(float* left, float* right) = 0;
  virtual Values& values() = 0;
  virtual Global& global() = 0;
};

template <class Fx>
struct Holder final : Instance {
  Global g;
  EffectState state;
  Values vals;
  Fx fx;

  Holder() : fx(&g, &state, &vals) {}

  int numParams() const override { return static_cast<int>(Fx::numParams); }
  ParamMeta paramAt(int index) const override { return fx.paramAt(index); }
  void initialize() override { fx.initialize(); }
  void onSampleRateChanged() override { fx.onSampleRateChanged(); }
  void processBlock(float* left, float* right) override { fx.processBlock(left, right); }
  Values& values() override { return vals; }
  Global& global() override { return g; }
};

/// Per-parameter tweaks applied after a param has been generated from the effect's metadata.
struct ParamOverride {
  std::string param;      ///< the generated id, e.g. "decay_time"
  uint32_t addFlags = 0;
  const char* doc = nullptr;
  /**
   * A default of our own, in the DISPLAY units the descriptor publishes.
   *
   * An effect's own default is the one its author chose for its own host, and that is not always a
   * default that shows what the module does the moment it is dropped on the canvas. Reverb 2 ships
   * LF Damping at 20 %, which on anything with low end in it removes most of the tail -- measured at
   * 7.7 dB and half the decay on a plucked sine (docs/adrs/0010). A module a person adds should
   * sound like the thing it is named after, so where the shipped default does not do that, this
   * says what does. Measure before changing one.
   */
  bool hasDefault = false;
  float def = 0.f;
  /// Set when this control does nothing until another one is off its neutral setting -- a band split
  /// while its factor is 1.0. `module:probe` reads it, so a control that is inert ON PURPOSE is
  /// declared rather than silently dead, which is the whole point of the probe.
  const char* dependsOn = nullptr;
};

/// Everything that distinguishes one sst-backed module from another.
struct EffectSpec {
  const char* id = nullptr;
  const char* name = nullptr;
  const char* category = "Audio FX";
  const char* doc = nullptr;
  std::function<Instance*()> create;
  /// The declared face, in the language of `ModuleDescriptor::face`. Empty leaves it to the interface.
  std::vector<std::string> faceRows;
  /// Controls that belong on the face when no rows are declared (`kParamPrimary`).
  std::vector<std::string> face;
  std::vector<ParamOverride> overrides;
  uint32_t moduleFlags = 0;
};

/// Builds a spec for one effect template. The module files call this and add their own face.
template <class Fx>
EffectSpec effectSpec(const char* id, const char* name, const char* doc) {
  EffectSpec spec;
  spec.id = id;
  spec.name = name;
  spec.doc = doc;
  spec.create = []() -> Instance* { return new Holder<Fx>(); };
  return spec;
}

/// Generates the descriptor. Allocated once per module type and never freed, like the Vital layer's.
const ModuleDescriptor& buildDescriptor(const EffectSpec& spec);
const EffectSpec& specFor(const ModuleDescriptor& desc);
/**
 * Whether a parameter of the effect is one we publish.
 *
 * An effect's parameter list can have holes in it: the delay's slot 9 is `dly_reserved`, a control
 * that was removed and whose index the others still sit around. It has no name and a range of
 * nothing, and a knob for it would be a knob that cannot move. Both `buildDescriptor` and
 * `WrappedEffect` ask this, and they have to agree -- the effect still reads its own index, so the
 * wrapper keeps a map from ours to its.
 */
inline bool publishable(const ParamMeta& meta) {
  return !meta.name.empty() && meta.maxVal > meta.minVal;
}

/// The id `buildDescriptor` generates for parameter `index`: the metadata's name, lowercased, with
/// runs of non-alphanumerics collapsed to one underscore. "Decay Time" -> "decay_time".
std::string paramIdFor(const ParamMeta& meta);

}  // namespace pg::sstfx

#pragma once
#include <array>
#include <memory>
#include <string>
#include <vector>
#include "core/Module.hpp"
#include "core/Signal.hpp"
#include "processor.h"
#include "vital/Spec.hpp"

namespace pg::vendor {

/// The vendored framework assumes every Output belongs to a Processor and asks that Processor, not the
/// Output, whether the signal is control rate -- `ModulationSum::process` dereferences `source->owner`
/// unconditionally. The adapter's Outputs have no processor behind them (they are our own blocks), so each
/// gets one of these stubs as its owner: it never runs, it only answers `isControlRate()`. Leaving `owner`
/// null instead is a segfault the moment a modulation destination is summed.
class AdapterSource final : public vital::Processor {
public:
  explicit AdapterSource(bool controlRate) : vital::Processor(0, 0, controlRate) {}
  vital::Processor* clone() const override { return new AdapterSource(*this); }
  void process(int) override {}
  bool hasState() const override { return false; }
};

/// One phasegrid Module wrapping one vendored `SynthModule`. Every vendored-backed module type is an
/// instance of this class bound to a different `ModuleSpec`; there is no per-module C++ subclass.
///
/// prepare() (message thread) builds the vendored module, plugs one adapter Output per mapped input and one
/// per modulatable control, and turns the modulation switches on. process() (audio thread) only points those
/// buffers at our blocks, derives triggers, sets knob values that changed, runs the module and copies its
/// outputs out -- no allocation, no locks, no exceptions.
class WrappedModule final : public Module {
public:
  static Module* createFromRegistry();   // reads pg::g_creatingDescriptor
  explicit WrappedModule(const ModuleDescriptor& desc);

  void configure(const ParamValues& values, const NodeData&) override { configured_ = values; }
  void prepare(const PrepareInfo&) override;
  void reset(uint32_t voicePair) override;
  void process(ProcessContext&) override;

private:
  struct BoundInput {
    BindKind kind = BindKind::Audio;
    int vendorInput = -1;
    std::unique_ptr<vital::Output> out;
    Sample lastGate = Sample(0.f);
  };
  struct BoundParam {
    std::string control;
    vital::Value* knob = nullptr;
    std::unique_ptr<vital::Output> modIn;
    int32_t modScratch = -1;   // index into modScratch_, or -1 when this param is not modulatable
    float lastKnob = 0.f;
    bool knobValid = false;
  };

  const ModuleDescriptor& desc_;
  const ModuleSpec& spec_;
  ParamValues configured_;
  alignas(16) std::array<Sample, kMaxBlockSize> midiScratch_{};
  alignas(16) std::array<Sample, kMaxBlockSize> zero_{};
  // Declared before module_ so they are destroyed AFTER it: the vendored module holds raw pointers into all
  // of these (owner stubs, context objects, adapter Outputs, modulation buffers) for its whole life.
  AdapterSource audioOwner_{false}, controlOwner_{true};
  ModuleContext ctx_;
  std::vector<Block> modScratch_;    // one per modulatable param, allocated in prepare()
  std::vector<BoundInput> inputs_;   // one per declared phasegrid input, same order
  std::vector<BoundParam> params_;   // one per descriptor param, same order
  std::unique_ptr<vital::SynthModule> module_;
};

}  // namespace pg::vendor

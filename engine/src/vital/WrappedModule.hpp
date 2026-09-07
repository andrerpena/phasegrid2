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
/// prepare() (message thread) builds ONE vendored module PER VOICE PAIR, plugs one adapter Output per mapped
/// input and one per modulatable control, and turns the modulation switches on. process() (audio thread) only
/// points those buffers at our blocks, derives triggers, sets knob values that changed, runs the module and
/// copies its outputs out -- no allocation, no locks, no exceptions.
///
/// A vendored `SynthModule` holds the DSP state of ONE `poly_float`, i.e. of one voice pair: an oscillator's
/// phase, a filter's memory, an envelope's stage. The scheduler runs the whole op list once per pair through
/// the same `Module`, so one vendored instance shared between pairs would have pair 1 running through pair
/// 0's filter and phase and the chord would collapse to whichever pair went last. The vendored library
/// solves this by cloning its processors per voice; we build a separate one per pair instead, because
/// `clone()` is not available on every vendored module (see `Sorted<T>::clone`).
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
    int32_t modScratch = -1;   // index into the pair's modScratch, or -1 when this param is not modulatable
    float lastKnob = 0.f;
    bool knobValid = false;
  };

  /// One voice pair's vendored module and everything wired into it. Held by pointer so the addresses the
  /// vendored module keeps into these members survive the vector growing.
  struct Pair {
    alignas(16) std::array<Sample, kMaxBlockSize> midiScratch{};
    alignas(16) std::array<Sample, kMaxBlockSize> zero{};
    // Declared before `module` so they are destroyed AFTER it: the vendored module holds raw pointers into
    // all of these (owner stubs, context objects, adapter Outputs, modulation buffers) for its whole life.
    AdapterSource audioOwner{false}, controlOwner{true};
    ModuleContext ctx;
    std::vector<Block> modScratch;    // one per modulatable param, allocated in prepare()
    std::vector<BoundInput> inputs;   // one per declared phasegrid input, same order
    std::vector<BoundParam> params;   // one per descriptor param, same order
    std::unique_ptr<vital::SynthModule> module;
  };

  void build(Pair& pair, const PrepareInfo& info);

  const ModuleDescriptor& desc_;
  const ModuleSpec& spec_;
  ParamValues configured_;
  std::vector<std::unique_ptr<Pair>> pairs_;   // one per voice pair, built in prepare()
};

}  // namespace pg::vendor

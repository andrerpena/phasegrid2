#include "vital/WrappedModule.hpp"
#include <stdexcept>
#include <string>
#include "core/Conventions.hpp"
#include "core/Registry.hpp"
#include "value.h"
#include "value_switch.h"
#include "vital/Descriptors.hpp"
#include "vital/Triggers.hpp"

namespace pg::vendor {

Module* WrappedModule::createFromRegistry() {
  if (!g_creatingDescriptor) throw std::runtime_error("wrapped module created outside InstanceTable::acquire");
  return new WrappedModule(*g_creatingDescriptor);
}

WrappedModule::WrappedModule(const ModuleDescriptor& desc) : desc_(desc), spec_(specFor(desc)) {}

void WrappedModule::prepare(const PrepareInfo& info) {
  inputs_.clear();
  params_.clear();
  modScratch_.clear();
  module_.reset(spec_.create(ctx_));
  if (spec_.configure) spec_.configure(*module_);

  // Inputs: one adapter Output per mapped port, plugged before init() so the module sees its sources while
  // it wires its own submodules. Control-rate kinds get a one-frame output.
  for (const InputMap& map : spec_.inputs) {
    BoundInput b;
    b.kind = map.kind;
    b.vendorInput = map.vendorInput;
    switch (map.kind) {
      case BindKind::ConstMidi:
      case BindKind::KeytrackOffset:
      case BindKind::NoteCount:
      case BindKind::ActiveVoices:
        b.out = std::make_unique<vital::cr::Output>();
        b.out->owner = &controlOwner_;
        break;
      case BindKind::Audio:
      case BindKind::Gate:
      case BindKind::PitchAsMidi:
        b.out = std::make_unique<vital::Output>();
        b.out->owner = &audioOwner_;
        break;
    }
    if (map.vendorInput >= 0) module_->plug(b.out.get(), static_cast<unsigned>(map.vendorInput));
    inputs_.push_back(std::move(b));
  }

  if (spec_.onConfigure) spec_.onConfigure(*module_, configured_);
  module_->init();
  if (spec_.postInit) spec_.postInit(*module_);
  module_->setSampleRate(static_cast<int>(info.sampleRate));

  // Params: bind each descriptor param to its control, and give every modulatable one its own modulation
  // input on the module's poly (or mono) modulation destination.
  const vital::control_map controls = module_->getControls();
  uint32_t modulatable = 0;
  for (uint32_t i = 0; i < desc_.numParams; ++i) if (desc_.params[i].flags & kParamModulatable) ++modulatable;
  modScratch_.resize(modulatable);   // resized once: process() must never grow it

  int32_t nextScratch = 0;
  for (uint32_t i = 0; i < desc_.numParams; ++i) {
    BoundParam p;
    p.control = controlName(spec_, desc_.params[i].id);
    auto found = controls.find(p.control);
    p.knob = found == controls.end() ? nullptr : found->second;   // a spec's extra params may have no control
    if (p.knob && (desc_.params[i].flags & kParamModulatable)) {
      vital::Processor* dest = module_->getPolyModulationDestination(p.control);
      const bool poly = dest != nullptr;
      if (!dest) dest = module_->getMonoModulationDestination(p.control);
      if (dest) {
        p.modIn = std::make_unique<vital::Output>();
        p.modIn->owner = &audioOwner_;   // full rate: the destination must sum it per sample, not read [0]
        dest->plugNext(p.modIn.get());
        if (vital::ValueSwitch* sw = module_->getModulationSwitch(p.control, poly)) sw->set(1);
        p.modScratch = nextScratch++;
      }
    }
    params_.push_back(std::move(p));
  }
  module_->updateAllModulationSwitches();
  zero_.fill(Sample(0.f));
  midiScratch_.fill(Sample(kMiddleCMidi));
}

void WrappedModule::reset(uint32_t) {
  if (module_) module_->hardReset();
}

void WrappedModule::process(ProcessContext& c) {
  const uint32_t n = c.numFrames;
  if (spec_.needsBeatsPerSecond)
    ctx_.beatsPerSecondOutput()->buffer[0] = Sample(static_cast<float>(c.transport->tempo / 60.0));

  // 1. Bind inputs. Full-rate kinds point straight at our block (zero copy); the vendored code never writes
  //    through an input's buffer, so dropping const here is safe.
  const Sample* audioIn = nullptr;
  for (uint32_t i = 0; i < inputs_.size(); ++i) {
    BoundInput& b = inputs_[i];
    // An unconnected input reads as silence. Take that silence from this instance's own zero block rather than
    // from the shared kSilentBlock: the buffer pointer we hand the vendored module loses its const below, and a
    // stray write through the shared block would be undefined behaviour that corrupts every module at once.
    // Per instance, the same mistake would be contained and debuggable.
    const SignalView in = c.in(i);
    const Sample* src = in.empty() ? zero_.data() : in.data;
    switch (b.kind) {
      case BindKind::Audio:
        b.out->buffer = const_cast<Sample*>(src);
        if (audioIn == nullptr) audioIn = src;
        break;
      case BindKind::Gate:
        b.out->buffer = const_cast<Sample*>(src);
        deriveTriggers(src, n, b.lastGate, *b.out);
        break;
      case BindKind::PitchAsMidi:
        for (uint32_t k = 0; k < n; ++k) midiScratch_[k] = pitchToMidiNote(src[k]);
        b.out->buffer = midiScratch_.data();
        b.out->trigger_value = midiScratch_[0];
        break;
      case BindKind::ConstMidi:
        b.out->buffer[0] = pitchToMidiNote(src[0]);
        break;
      case BindKind::KeytrackOffset:
        b.out->buffer[0] = pitchToMidiNote(src[0]) - Sample(kMiddleCMidi);
        break;
      case BindKind::NoteCount:
        b.out->buffer[0] = Sample(1.f);
        break;
      case BindKind::ActiveVoices:
        b.out->buffer[0] = Sample(1.f) & c.voiceMask;
        break;
    }
  }

  // 2. Params. The knob takes the unmodulated value; the modulation destination takes (effective - knob) per
  //    sample, which is what "knob + signal, clamped" means in the pre-scale units the module expects.
  for (uint32_t i = 0; i < params_.size(); ++i) {
    BoundParam& p = params_[i];
    if (!p.knob) continue;
    const ParamView view = c.param(i);
    const float base = view.knob;   // unmodulated; the modulation goes to the module's own destination
    if (!p.knobValid || base != p.lastKnob) {
      p.knob->set(Sample(base));
      p.lastKnob = base;
      p.knobValid = true;
    }
    if (p.modScratch < 0) continue;
    Sample* mod = modScratch_[static_cast<size_t>(p.modScratch)].data.data();
    if (view.polyBuf)
      for (uint32_t k = 0; k < n; ++k) mod[k] = view.polyBuf[k] - Sample(base);
    else
      for (uint32_t k = 0; k < n; ++k) mod[k] = Sample(0.f);
    p.modIn->buffer = mod;
  }

  // 3. Run.
  if (spec_.processWithInput) module_->processWithInput(audioIn ? audioIn : zero_.data(), static_cast<int>(n));
  else module_->process(static_cast<int>(n));

  // 4. Outputs. The module owns its output buffers, so this is a copy; some outputs are control rate.
  for (uint32_t o = 0; o < spec_.outputs.size(); ++o) {
    Sample* dst = c.out(o).data;
    if (dst == nullptr) continue;   // output not connected to anything
    const vital::Output* out = module_->output(spec_.outputs[o].vendorOutput);
    if (out->isControlRate()) {
      const Sample v = out->buffer[0];
      for (uint32_t k = 0; k < n; ++k) dst[k] = v;
    } else {
      for (uint32_t k = 0; k < n; ++k) dst[k] = out->buffer[k];
    }
  }
}

}  // namespace pg::vendor

#include "modules/TestModules.hpp"
#include <algorithm>
#include <cmath>
#include <stdexcept>
#include "core/Module.hpp"
#include "core/Voices.hpp"

namespace pg::test {
namespace {

const PortDesc kConstOut[] = {{"out", "Out", PortKind::Continuous, 1, SignalRole::Cv, ""}};
const ParamDesc kConstParams[] = {{"value", "Value", -1.f, 1.f, 0.f, ParamUnit::None, ParamCurve::Linear, kParamModulatable, nullptr, 0, "slider", nullptr, ""}};
class Const : public VoicedModule<int> {
  void process(ProcessContext& c) override {
    const ParamView v = c.param(0); Sample* o = c.out(0).data;
    for (uint32_t i = 0; i < c.numFrames; ++i) o[i] = v.at(i);
  }
};
const ModuleDescriptor kConst{kModuleAbiVersion, "test.const", "Const", "test", "", nullptr, 0, kConstOut, 1, kConstParams, 1, 0, 0, [] () -> Module* { return new Const(); }, nullptr, 0};

// Deliberately asymmetric source: the only test module whose L lanes differ from its R lanes,
// so a transposed out[0]/out[1] fold, a swapped lanes::left()/right() mask, or swapStereo used
// where swapVoices belongs shows up as a failure instead of passing green.
const PortDesc kStereoOut[] = {{"out", "Out", PortKind::Continuous, 1, SignalRole::Audio, ""}};
const ParamDesc kStereoParams[] = {
  {"l", "L", -1.f, 1.f, 0.f, ParamUnit::None, ParamCurve::Linear, kParamModulatable, nullptr, 0, "slider", nullptr, ""},
  {"r", "R", -1.f, 1.f, 0.f, ParamUnit::None, ParamCurve::Linear, kParamModulatable, nullptr, 0, "slider", nullptr, ""}};
class Stereo : public VoicedModule<int> {
  void process(ProcessContext& c) override {
    const ParamView l = c.param(0), r = c.param(1); Sample* o = c.out(0).data;
    for (uint32_t i = 0; i < c.numFrames; ++i) o[i] = lanes::stereo(lanes::lane(l.at(i), 0), lanes::lane(r.at(i), 0));
  }
};
const ModuleDescriptor kStereo{kModuleAbiVersion, "test.stereo", "Stereo", "test", "", nullptr, 0, kStereoOut, 1, kStereoParams, 2, 0, 0, [] () -> Module* { return new Stereo(); }, nullptr, 0};

const PortDesc kGainIn[] = {{"in", "In", PortKind::Continuous, 1, SignalRole::Any, ""}};
const PortDesc kGainOut[] = {{"out", "Out", PortKind::Continuous, 1, SignalRole::Any, ""}};
const ParamDesc kGainParams[] = {{"gain", "Gain", 0.f, 2.f, 1.f, ParamUnit::Ratio, ParamCurve::Linear, kParamModulatable, nullptr, 0, "slider", nullptr, ""}};
class Gain : public VoicedModule<int> {
  void process(ProcessContext& c) override {
    const Sample* in = c.in(0).readOr(); Sample* o = c.out(0).data; const ParamView g = c.param(0);
    for (uint32_t i = 0; i < c.numFrames; ++i) o[i] = in[i] * g.at(i);
  }
};
const ModuleDescriptor kGain{kModuleAbiVersion, "test.gain", "Gain", "test", "", kGainIn, 1, kGainOut, 1, kGainParams, 1, 0, 0, [] () -> Module* { return new Gain(); }, nullptr, 0};

const PortDesc kAddIn[] = {{"a", "A", PortKind::Continuous, 1, SignalRole::Any, ""}, {"b", "B", PortKind::Continuous, 1, SignalRole::Any, ""}};
const PortDesc kAddOut[] = {{"out", "Out", PortKind::Continuous, 1, SignalRole::Any, ""}};
class Add : public VoicedModule<int> {
  void process(ProcessContext& c) override {
    const Sample* a = c.in(0).readOr(); const Sample* b = c.in(1).readOr(); Sample* o = c.out(0).data;
    for (uint32_t i = 0; i < c.numFrames; ++i) o[i] = a[i] + b[i];
  }
};
const ModuleDescriptor kAdd{kModuleAbiVersion, "test.add", "Add", "test", "", kAddIn, 2, kAddOut, 1, nullptr, 0, 0, 0, [] () -> Module* { return new Add(); }, nullptr, 0};

struct ImpulseState { bool fired = false; };
const PortDesc kImpulseOut[] = {{"out", "Out", PortKind::Continuous, 1, SignalRole::Gate, ""}};
class Impulse : public VoicedModule<ImpulseState> {
  void process(ProcessContext& c) override {
    Sample* o = c.out(0).data;
    for (uint32_t i = 0; i < c.numFrames; ++i) o[i] = Sample(0.f);
    if (!st(c).fired) { o[0] = Sample(1.f); st(c).fired = true; }
  }
};
const ModuleDescriptor kImpulse{kModuleAbiVersion, "test.impulse", "Impulse", "test", "", nullptr, 0, kImpulseOut, 1, nullptr, 0, 0, 0, [] () -> Module* { return new Impulse(); }, nullptr, 0};

const PortDesc kSinkIn[] = {{"in", "In", PortKind::Continuous, 1, SignalRole::Audio, ""}};
/// An exit that only folds: it never holds a voice, so a released voice is free at the end of its block.
class Sink : public VoicedModule<int> {
  void process(ProcessContext& c) override {
    const Sample* in = c.in(0).readOr();
    for (uint32_t i = 0; i < c.numFrames; ++i) {
      // A terminal masks its own contribution: the fold in Engine::renderBlock sees every pair at once.
      const Sample masked = in[i] & c.voiceMask;
      if (c.outputBus) c.outputBus->data[i] += masked;
    }
  }
};
const ModuleDescriptor kSink{kModuleAbiVersion, "test.sink", "Sink", "test", "", kSinkIn, 1, nullptr, 0, nullptr, 0, kModuleTerminal | kModuleVoiceExit, 0, [] () -> Module* { return new Sink(); }, nullptr, 0};

const PortDesc kEvGenOut[] = {{"events", "Events", PortKind::Event, 0, SignalRole::Gate, ""}};   // bare triggers, not notes
const ParamDesc kEvGenParams[] = {
  {"frame", "Frame", 0.f, 127.f, 0.f, ParamUnit::None, ParamCurve::Linear, kParamInteger | kParamNoSmooth, nullptr, 0, "slider", nullptr, ""},
  {"tag", "Tag", 0.f, 100.f, 1.f, ParamUnit::None, ParamCurve::Linear, kParamInteger | kParamNoSmooth, nullptr, 0, "slider", nullptr, ""}};
class EventGen : public VoicedModule<int> {
  void process(ProcessContext& c) override {
    const uint32_t frame = static_cast<uint32_t>(lanes::lane(c.param(0).at(0), 0));
    if (frame >= c.numFrames) return;
    Event e; e.frame = frame; e.type = EventType::Trigger; e.a = lanes::lane(c.param(1).at(0), 0);
    c.eventOut(0).push(e);
  }
};
const ModuleDescriptor kEventGen{kModuleAbiVersion, "test.eventGen", "EventGen", "test", "", nullptr, 0, kEvGenOut, 1, kEvGenParams, 2, 0, 0, [] () -> Module* { return new EventGen(); }, nullptr, 0};

const PortDesc kEvTraceIn[] = {{"events", "Events", PortKind::Event, 0, SignalRole::Gate, ""}};
const PortDesc kEvTraceOut[] = {{"out", "Out", PortKind::Continuous, 1, SignalRole::Cv, ""}};
class EventTrace : public VoicedModule<int> {
  void process(ProcessContext& c) override {
    Sample* o = c.out(0).data;
    for (uint32_t i = 0; i < c.numFrames; ++i) o[i] = Sample(0.f);
    for (const Event& e : c.eventIn(0)) if (e.frame < c.numFrames) o[e.frame] += Sample(e.a);
  }
};
const ModuleDescriptor kEventTrace{kModuleAbiVersion, "test.eventTrace", "EventTrace", "test", "", kEvTraceIn, 1, kEvTraceOut, 1, nullptr, 0, 0, 0, [] () -> Module* { return new EventTrace(); }, nullptr, 0};

}  // namespace

/// Counts the blocks it has run and puts the count out, and `adopt`s the count from the instance it
/// replaces. Its node data means nothing to it, so any change to it is a rebuild for its own sake: what the
/// engine's hand-over at the swap is tested with.
const PortDesc kBlockCountOut[] = {{"out", "Out", PortKind::Continuous, 1, SignalRole::Cv, ""}};
class BlockCount : public Module {
  void prepare(const PrepareInfo&) override { count_ = 0; }
  void adopt(const Module& retiring) override { count_ = static_cast<const BlockCount&>(retiring).count_; }
  void process(ProcessContext& c) override {
    if (c.firstPass) ++count_;
    Sample* o = c.out(0).data;
    for (uint32_t i = 0; i < c.numFrames; ++i) o[i] = Sample(static_cast<float>(count_));
  }
  uint32_t count_ = 0;
};
const ModuleDescriptor kBlockCount{kModuleAbiVersion, "test.blockCount", "BlockCount", "test", "", nullptr, 0, kBlockCountOut, 1, nullptr, 0, 0, 0, [] () -> Module* { return new BlockCount(); }, nullptr, 0};

void registerTestModules(Registry& r) {
  for (const ModuleDescriptor* d : {&kConst, &kStereo, &kGain, &kAdd, &kImpulse, &kSink, &kEventGen, &kEventTrace, &kBlockCount})
    if (auto err = r.add(*d)) throw std::runtime_error(*err);
}

}  // namespace pg::test

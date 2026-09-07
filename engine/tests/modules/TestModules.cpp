#include "modules/TestModules.hpp"
#include <stdexcept>
#include "core/Module.hpp"

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
const ModuleDescriptor kConst{kModuleAbiVersion, "test.const", "Const", "test", "", nullptr, 0, kConstOut, 1, kConstParams, 1, 0, 0, [] () -> Module* { return new Const(); }};

const PortDesc kGainIn[] = {{"in", "In", PortKind::Continuous, 1, SignalRole::Any, ""}};
const PortDesc kGainOut[] = {{"out", "Out", PortKind::Continuous, 1, SignalRole::Any, ""}};
const ParamDesc kGainParams[] = {{"gain", "Gain", 0.f, 2.f, 1.f, ParamUnit::Ratio, ParamCurve::Linear, kParamModulatable, nullptr, 0, "slider", nullptr, ""}};
class Gain : public VoicedModule<int> {
  void process(ProcessContext& c) override {
    const Sample* in = c.in(0).readOr(); Sample* o = c.out(0).data; const ParamView g = c.param(0);
    for (uint32_t i = 0; i < c.numFrames; ++i) o[i] = in[i] * g.at(i);
  }
};
const ModuleDescriptor kGain{kModuleAbiVersion, "test.gain", "Gain", "test", "", kGainIn, 1, kGainOut, 1, kGainParams, 1, 0, 0, [] () -> Module* { return new Gain(); }};

const PortDesc kAddIn[] = {{"a", "A", PortKind::Continuous, 1, SignalRole::Any, ""}, {"b", "B", PortKind::Continuous, 1, SignalRole::Any, ""}};
const PortDesc kAddOut[] = {{"out", "Out", PortKind::Continuous, 1, SignalRole::Any, ""}};
class Add : public VoicedModule<int> {
  void process(ProcessContext& c) override {
    const Sample* a = c.in(0).readOr(); const Sample* b = c.in(1).readOr(); Sample* o = c.out(0).data;
    for (uint32_t i = 0; i < c.numFrames; ++i) o[i] = a[i] + b[i];
  }
};
const ModuleDescriptor kAdd{kModuleAbiVersion, "test.add", "Add", "test", "", kAddIn, 2, kAddOut, 1, nullptr, 0, 0, 0, [] () -> Module* { return new Add(); }};

struct ImpulseState { bool fired = false; };
const PortDesc kImpulseOut[] = {{"out", "Out", PortKind::Continuous, 1, SignalRole::Gate, ""}};
class Impulse : public VoicedModule<ImpulseState> {
  void process(ProcessContext& c) override {
    Sample* o = c.out(0).data;
    for (uint32_t i = 0; i < c.numFrames; ++i) o[i] = Sample(0.f);
    if (!st(c).fired) { o[0] = Sample(1.f); st(c).fired = true; }
  }
};
const ModuleDescriptor kImpulse{kModuleAbiVersion, "test.impulse", "Impulse", "test", "", nullptr, 0, kImpulseOut, 1, nullptr, 0, 0, 0, [] () -> Module* { return new Impulse(); }};

const PortDesc kSinkIn[] = {{"in", "In", PortKind::Continuous, 1, SignalRole::Audio, ""}};
class Sink : public VoicedModule<int> {
  void process(ProcessContext& c) override {
    if (!c.outputBus) return;
    const Sample* in = c.in(0).readOr();
    for (uint32_t i = 0; i < c.numFrames; ++i) c.outputBus->data[i] += in[i];
  }
};
const ModuleDescriptor kSink{kModuleAbiVersion, "test.sink", "Sink", "test", "", kSinkIn, 1, nullptr, 0, nullptr, 0, kModuleTerminal, 0, [] () -> Module* { return new Sink(); }};

const PortDesc kEvGenOut[] = {{"events", "Events", PortKind::Event, 0, SignalRole::Any, ""}};
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
const ModuleDescriptor kEventGen{kModuleAbiVersion, "test.eventGen", "EventGen", "test", "", nullptr, 0, kEvGenOut, 1, kEvGenParams, 2, 0, 0, [] () -> Module* { return new EventGen(); }};

const PortDesc kEvTraceIn[] = {{"events", "Events", PortKind::Event, 0, SignalRole::Any, ""}};
const PortDesc kEvTraceOut[] = {{"out", "Out", PortKind::Continuous, 1, SignalRole::Cv, ""}};
class EventTrace : public VoicedModule<int> {
  void process(ProcessContext& c) override {
    Sample* o = c.out(0).data;
    for (uint32_t i = 0; i < c.numFrames; ++i) o[i] = Sample(0.f);
    for (const Event& e : c.eventIn(0)) if (e.frame < c.numFrames) o[e.frame] += Sample(e.a);
  }
};
const ModuleDescriptor kEventTrace{kModuleAbiVersion, "test.eventTrace", "EventTrace", "test", "", kEvTraceIn, 1, kEvTraceOut, 1, nullptr, 0, 0, 0, [] () -> Module* { return new EventTrace(); }};

}  // namespace

void registerTestModules(Registry& r) {
  for (const ModuleDescriptor* d : {&kConst, &kGain, &kAdd, &kImpulse, &kSink, &kEventGen, &kEventTrace})
    if (auto err = r.add(*d)) throw std::runtime_error(*err);
}

}  // namespace pg::test

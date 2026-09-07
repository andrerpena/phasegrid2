#include "vital/Descriptors.hpp"
#include <algorithm>
#include <list>
#include <map>
#include <memory>
#include <stdexcept>
#include <vector>
#include "core/Conventions.hpp"
#include "synth_parameters.h"
#include "vital/WrappedModule.hpp"

namespace pg::vendor {
namespace {

/// Everything a generated descriptor points at. Allocated once per module type and never freed: descriptors
/// outlive every Registry, Program and patch that holds raw pointers into them, i.e. the whole process.
/// `strings` and `enumTables` are node-based on purpose -- `keep()` hands out `c_str()` pointers, so the
/// storage must never move.
struct Built {
  ModuleSpec spec;
  std::list<std::string> strings;
  std::list<std::vector<const char*>> enumTables;
  std::vector<PortDesc> inputs, outputs;
  std::vector<ParamDesc> params;
  ModuleDescriptor desc{};
};

std::map<const ModuleDescriptor*, Built*>& builtRegistry() {
  static auto* r = new std::map<const ModuleDescriptor*, Built*>();
  return *r;
}

const char* keep(Built& b, std::string s) {
  b.strings.push_back(std::move(s));
  return b.strings.back().c_str();
}

ParamUnit unitFor(const std::string& u) {
  if (u.find("semitone") != std::string::npos) return ParamUnit::Semitones;
  if (u.find("dB") != std::string::npos) return ParamUnit::Db;
  if (u.find("sec") != std::string::npos || u.find("ms") != std::string::npos) return ParamUnit::Seconds;
  if (u.find("Hz") != std::string::npos) return ParamUnit::Hz;
  if (u.find('%') != std::string::npos) return ParamUnit::Percent;
  return ParamUnit::None;
}

const ControlOverride* findOverride(const ModuleSpec& spec, const std::string& suffix) {
  for (const ControlOverride& o : spec.overrides)
    if (o.control == suffix) return &o;
  return nullptr;
}

/// Copies `count` labels into stable storage and points the param at them.
void attachLabels(Built& b, ParamDesc& p, const std::string* labels, uint32_t count) {
  std::vector<const char*> table;
  table.reserve(count);
  for (uint32_t i = 0; i < count; ++i) table.push_back(keep(b, labels[i]));
  b.enumTables.push_back(std::move(table));
  p.enumLabels = b.enumTables.back().data();
  p.enumCount = static_cast<uint32_t>(b.enumTables.back().size());
  p.flags |= kParamEnum;
  p.uiWidget = "select";
}

}  // namespace

const ModuleDescriptor& buildDescriptor(const ModuleSpec& specIn) {
  auto* b = new Built{};
  b->spec = specIn;
  if (!b->spec.id || !b->spec.create) throw std::runtime_error("vendored module spec needs an id and a create()");

  // 1. Instantiate once to discover the controls and modulation destinations this module actually has.
  //    `probeCtx` is declared first so it outlives the module that may hold pointers into it.
  ModuleContext probeCtx;
  std::unique_ptr<vital::SynthModule> probe(b->spec.create(probeCtx));
  if (!probe) throw std::runtime_error(std::string(b->spec.id) + ": create() returned null");
  if (b->spec.configure) b->spec.configure(*probe);
  if (b->spec.onConfigure) b->spec.onConfigure(*probe, probeCtx, ParamValues{});
  probe->init();
  if (b->spec.postInit) b->spec.postInit(*probe);
  const vital::control_map controls = probe->getControls();

  // 2. Ports.
  for (const InputMap& in : b->spec.inputs) {
    if (in.vendorInput >= probe->numInputs())
      throw std::runtime_error(std::string(b->spec.id) + ": input " + in.id + " is out of range");
    b->inputs.push_back(PortDesc{in.id, in.name, PortKind::Continuous, 1, in.role, in.doc});
  }
  for (const OutputMap& out : b->spec.outputs) {
    if (out.vendorOutput < 0 || out.vendorOutput >= probe->numOutputs())
      throw std::runtime_error(std::string(b->spec.id) + ": output " + out.id + " is out of range");
    b->outputs.push_back(PortDesc{out.id, out.name, PortKind::Continuous, 1, out.role, out.doc});
  }

  // 3. Params: the spec's own extras first, then one per exposed control, ordered by suffix so the order is
  //    stable across runs (control_map is keyed by the prefixed name, which sorts differently per module).
  b->params = b->spec.extraParams;
  std::vector<std::string> names;
  names.reserve(controls.size());
  for (const auto& [name, value] : controls) names.push_back(name);
  std::sort(names.begin(), names.end(),
            [&](const std::string& x, const std::string& y) { return controlSuffix(b->spec, x) < controlSuffix(b->spec, y); });

  for (const std::string& full : names) {
    const std::string suffix = controlSuffix(b->spec, full);
    if (std::find(b->spec.hidden.begin(), b->spec.hidden.end(), suffix) != b->spec.hidden.end()) continue;
    const ControlOverride* over = findOverride(b->spec, suffix);
    const bool described = vital::Parameters::isParameter(full);
    if (!described && !(over && over->exposeNonParameter)) continue;   // e.g. the `_sync` values a tempo switch creates

    ParamDesc p{};
    p.id = keep(*b, suffix);
    p.curve = ParamCurve::Linear;   // the vendored module applies its own value_scale internally
    p.uiWidget = "slider";
    p.group = nullptr;

    if (described) {
      const vital::ValueDetails& d = vital::Parameters::getDetails(full);
      p.name = keep(*b, d.local_description.empty() ? d.display_name : d.local_description);
      p.min = d.min;
      p.max = d.max;
      p.def = d.default_value;
      p.unit = unitFor(d.display_units);
      p.doc = keep(*b, d.display_name);
      if (d.value_scale == vital::ValueDetails::kIndexed) {
        p.flags = kParamInteger | kParamNoSmooth;
        const bool suppressed = over && over->suppressLabels;
        if (over && over->labels && over->labelCount > 0) attachLabels(*b, p, over->labels, over->labelCount);
        else if (d.string_lookup && !suppressed) {
          // The vendored lookup is indexed by the control's raw value, not by its offset from `min`, so a
          // control whose range starts above zero (the delay's `tempo` is 4..12) has to skip that many names.
          // Reading from index 0 there labels every step with the name of a different one.
          const int first = d.min > 0.f ? static_cast<int>(d.min) : 0;
          attachLabels(*b, p, d.string_lookup + first, static_cast<uint32_t>(d.max - d.min) + 1);
        }
      } else if (probe->getPolyModulationDestination(full) != nullptr ||
                 probe->getMonoModulationDestination(full) != nullptr) {
        p.flags = kParamModulatable;
      }
    } else {
      p.name = keep(*b, suffix);
      p.min = over->min;
      p.max = over->max;
      p.def = over->def;
      p.unit = ParamUnit::None;
      p.doc = over->doc ? over->doc : "";
      p.flags = kParamInteger | kParamNoSmooth;
      if (over->labels && over->labelCount > 0) attachLabels(*b, p, over->labels, over->labelCount);
    }

    if (over) {
      p.flags |= over->addFlags;
      if (over->doc) p.doc = over->doc;
    }
    // The handful of controls this module wears on its face. Named by the spec rather than guessed at
    // here, because which controls matter is the module's knowledge and nothing about the vendored
    // parameter table says so.
    if (std::find(b->spec.face.begin(), b->spec.face.end(), suffix) != b->spec.face.end())
      p.flags |= kParamPrimary;
    b->params.push_back(p);
  }
  if (b->params.size() > kMaxParamsPerModule) throw std::runtime_error(std::string(b->spec.id) + ": too many params");

  // 4. The descriptor itself.
  ModuleDescriptor& m = b->desc;
  m.abiVersion = kModuleAbiVersion;
  m.id = b->spec.id;
  m.name = b->spec.name;
  m.category = b->spec.category;
  m.doc = b->spec.doc;
  m.inputs = b->inputs.data();
  m.numInputs = static_cast<uint32_t>(b->inputs.size());
  m.outputs = b->outputs.data();
  m.numOutputs = static_cast<uint32_t>(b->outputs.size());
  m.params = b->params.data();
  m.numParams = static_cast<uint32_t>(b->params.size());
  m.flags = b->spec.moduleFlags;
  m.telemetrySlots = 0;
  m.create = &WrappedModule::createFromRegistry;   // finds its spec through g_creatingDescriptor + specFor()
  builtRegistry()[&m] = b;
  return m;
}

const ModuleSpec& specFor(const ModuleDescriptor& desc) {
  auto it = builtRegistry().find(&desc);
  if (it == builtRegistry().end()) throw std::runtime_error("descriptor was not generated by buildDescriptor");
  return it->second->spec;
}

}  // namespace pg::vendor

#include "sst/Descriptors.hpp"
#include <algorithm>
#include <cctype>
#include <cmath>
#include <list>
#include <map>
#include <set>
#include <stdexcept>
#include "sst/WrappedEffect.hpp"

namespace pg::sstfx {
namespace {

/// Everything a generated descriptor points at. Allocated once per module type and never freed:
/// descriptors outlive every Registry, Program and patch that holds raw pointers into them.
/// `strings` is node-based on purpose -- `keep()` hands out `c_str()` pointers.
struct Built {
  EffectSpec spec;
  std::list<std::string> strings;
  std::list<std::vector<const char*>> enumTables;
  std::vector<PortDesc> inputs, outputs;
  std::vector<ParamDesc> params;
  std::vector<const char*> faceRows;
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
  if (u == "s" || u == "sec" || u == "secs" || u == "seconds") return ParamUnit::Seconds;
  if (u == "ms") return ParamUnit::Milliseconds;
  if (u == "dB" || u == "db") return ParamUnit::Db;
  if (u == "%") return ParamUnit::Percent;
  if (u == "Hz" || u == "hz" || u == "kHz") return ParamUnit::Hz;
  if (u.find("semitone") != std::string::npos || u == "st") return ParamUnit::Semitones;
  if (u == "x" || u == "ratio") return ParamUnit::Ratio;
  return ParamUnit::None;
}

/**
 * The display range and taper for one parameter.
 *
 * An sst parameter has a NATIVE range -- what the DSP reads -- and a display scaling that turns it
 * into something a person reads. Decay Time is -4..6 natively and 0.0625..64 seconds on the panel.
 * Publishing the native number with the display's unit is exactly the lie `docs/engine.md` records
 * against the Vital-generated params, so we publish the display range and the curve that reproduces
 * the native mapping. The engine then converts back on its way in (`WrappedEffect::nativeOf`).
 *
 * `LINEAR` is `svA * r + svB`, and `A_TWO_TO_THE_B` is `svA * 2^(svB * r + svC) + svD`, which is
 * exactly `ParamCurve::Log` whenever the offset `svD` is zero. Every scaling the library uses that
 * we have not met yet throws, so an effect that needs one is a build that fails rather than a knob
 * that lies -- which is the failure this whole layer exists to end.
 */
struct Range {
  float min, max, def;
  ParamCurve curve;
};

Range rangeOf(const ParamMeta& m, const std::string& id) {
  const auto lin = [&](float r) { return m.svA * r + m.svB; };
  const auto pow2 = [&](float r) { return m.svA * std::exp2(m.svB * r + m.svC) + m.svD; };
  switch (m.displayScale) {
    case ParamMeta::LINEAR: {
      Range r{lin(m.minVal), lin(m.maxVal), lin(m.defaultVal), ParamCurve::Linear};
      if (r.min > r.max) std::swap(r.min, r.max);   // a negative svA flips the range
      return r;
    }
    case ParamMeta::A_TWO_TO_THE_B: {
      if (m.svD != 0.f || m.svA <= 0.f) break;      // an offset is not a log curve
      return {pow2(m.minVal), pow2(m.maxVal), pow2(m.defaultVal), ParamCurve::Log};
    }
    case ParamMeta::UNORDERED_MAP:
    case ParamMeta::MIDI_NOTE:
      // Stepped: the native value IS the value, and the labels come from `discreteValues`.
      return {m.minVal, m.maxVal, m.defaultVal, ParamCurve::Linear};
    default:
      break;
  }
  throw std::runtime_error("sst param `" + id + "`: display scaling " +
                           std::to_string(static_cast<int>(m.displayScale)) +
                           " is not mapped yet -- add it to rangeOf() rather than shipping a knob "
                           "whose label does not match its value");
}

const ParamOverride* findOverride(const EffectSpec& spec, const std::string& id) {
  for (const ParamOverride& o : spec.overrides)
    if (o.param == id) return &o;
  return nullptr;
}

}  // namespace

namespace {
/// "Decay Time" -> "decay_time"; anything with no letters or digits in it comes back empty.
std::string slug(const std::string& text) {
  std::string out;
  bool pendingUnderscore = false;
  for (const char c : text) {
    if (std::isalnum(static_cast<unsigned char>(c))) {
      if (pendingUnderscore && !out.empty()) out.push_back('_');
      pendingUnderscore = false;
      out.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
    } else {
      pendingUnderscore = true;
    }
  }
  return out;
}
}  // namespace

std::string paramIdFor(const ParamMeta& meta) {
  const std::string out = slug(meta.name);
  return out.empty() ? "param" : out;
}

const ModuleDescriptor& buildDescriptor(const EffectSpec& specIn) {
  auto* b = new Built{};
  b->spec = specIn;
  if (!b->spec.id || !b->spec.create) throw std::runtime_error("sst effect spec needs an id and a create()");

  // 1. One probe instance, to read the effect's own description of its parameters.
  const std::unique_ptr<Instance> probe(b->spec.create());
  if (!probe) throw std::runtime_error(std::string(b->spec.id) + ": create() returned null");
  if (probe->numParams() > kMaxEffectParams)
    throw std::runtime_error(std::string(b->spec.id) + ": more params than kMaxEffectParams");

  // 2. Ports. Every effect has the same shape: stereo in, stereo out, always on.
  b->inputs.push_back(PortDesc{"in", "In", PortKind::Continuous, 1, SignalRole::Audio,
                               "Audio input. Stereo: the left and right lanes stay apart throughout"});
  b->outputs.push_back(PortDesc{"out", "Out", PortKind::Continuous, 1, SignalRole::Audio,
                                "The processed signal"});

  // 3. Params, one per declared parameter, in the effect's own order.
  // Ids have to be unique -- they name the param on the wire, in a patch file and in a face row --
  // and an effect's parameter NAMES are not: Bonsai calls three different controls "Gain", one per
  // stage, and one of the delay's is unnamed. So a repeat is qualified by its group ("Bass Boost"
  // gives `bass_boost_gain`), and only if that still collides does it get a number.
  std::set<std::string> taken;
  for (int i = 0; i < probe->numParams(); ++i) {
    const ParamMeta meta = probe->paramAt(i);
    if (!publishable(meta)) continue;
    std::string id = paramIdFor(meta);
    if (taken.count(id) > 0) {
      const std::string group = slug(meta.groupName);
      if (!group.empty() && taken.count(group + "_" + id) == 0) {
        id = group + "_" + id;
      } else {
        const std::string base = id;
        for (int n = 2; taken.count(id) > 0; ++n) id = base + "_" + std::to_string(n);
      }
    }
    taken.insert(id);
    const Range range = rangeOf(meta, id);

    ParamDesc p{};
    p.id = keep(*b, id);
    p.name = keep(*b, meta.name);
    p.min = range.min;
    p.max = range.max;
    // An effect's own default can sit outside its own range -- Reverb 1 ships a High Cut of
    // 28160 Hz against a maximum of 25087 -- and the protocol refuses that, rightly. Clamp rather
    // than reject: the value the effect wants is "all the way open", and that is what this is.
    p.def = std::clamp(range.def, range.min, range.max);
    p.curve = range.curve;
    p.unit = unitFor(meta.unit);
    p.uiWidget = "knob";
    p.group = meta.groupName.empty() ? nullptr : keep(*b, meta.groupName);
    p.doc = keep(*b, meta.name);
    p.flags = kParamModulatable;

    if (meta.type == ParamMeta::INT || meta.type == ParamMeta::BOOL) {
      p.flags = kParamInteger | kParamNoSmooth;
      p.curve = ParamCurve::Linear;
      if (!meta.discreteValues.empty()) {
        std::vector<const char*> table;
        for (int v = static_cast<int>(meta.minVal); v <= static_cast<int>(meta.maxVal); ++v) {
          const auto it = meta.discreteValues.find(v);
          table.push_back(keep(*b, it == meta.discreteValues.end() ? std::to_string(v) : it->second));
        }
        b->enumTables.push_back(std::move(table));
        p.enumLabels = b->enumTables.back().data();
        p.enumCount = static_cast<uint32_t>(b->enumTables.back().size());
        p.flags |= kParamEnum;
        p.uiWidget = "select";
      }
    }

    if (const ParamOverride* over = findOverride(b->spec, id)) {
      p.flags |= over->addFlags;
      if (over->doc) p.doc = over->doc;
    }
    if (std::find(b->spec.face.begin(), b->spec.face.end(), id) != b->spec.face.end())
      p.flags |= kParamPrimary;
    b->params.push_back(p);
  }

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
  m.create = &WrappedEffect::createFromRegistry;
  for (const std::string& row : b->spec.faceRows) b->faceRows.push_back(keep(*b, row));
  m.face = b->faceRows.empty() ? nullptr : b->faceRows.data();
  m.faceRows = static_cast<uint32_t>(b->faceRows.size());
  builtRegistry()[&m] = b;
  return m;
}

const EffectSpec& specFor(const ModuleDescriptor& desc) {
  auto it = builtRegistry().find(&desc);
  if (it == builtRegistry().end()) throw std::runtime_error("descriptor was not generated by buildDescriptor");
  return it->second->spec;
}

}  // namespace pg::sstfx

#include "services/Catalog.hpp"
#include <algorithm>
#include <cstdint>
#include <string>
#include <vector>
#include "core/Conventions.hpp"

namespace pg {
namespace {

const char* kindName(PortKind k) { return k == PortKind::Event ? "event" : "continuous"; }

const char* roleName(SignalRole r) {
  switch (r) {
    case SignalRole::Any:   return "any";
    case SignalRole::Audio: return "audio";
    case SignalRole::Cv:    return "cv";
    case SignalRole::Gate:  return "gate";
    case SignalRole::Pitch: return "pitch";
    case SignalRole::Phase: return "phase";
    case SignalRole::Note:  return "note";
  }
  return "any";
}

const char* unitName(ParamUnit u) {
  switch (u) {
    case ParamUnit::None:      return "none";
    case ParamUnit::Hz:        return "hz";
    case ParamUnit::Seconds:   return "seconds";
    case ParamUnit::Db:        return "db";
    case ParamUnit::Semitones: return "semitones";
    case ParamUnit::Percent:   return "percent";
    case ParamUnit::Ratio:     return "ratio";
    case ParamUnit::Milliseconds: return "milliseconds";
  }
  return "none";
}

const char* curveName(ParamCurve c) {
  switch (c) {
    case ParamCurve::Linear:  return "linear";
    case ParamCurve::Log:     return "log";
    case ParamCurve::Exp:     return "exp";
    case ParamCurve::Quartic: return "quartic";
  }
  return "linear";
}

/// A descriptor string may be null (the ABI allows it); the JSON must not be.
const char* text(const char* s) { return s ? s : ""; }

nlohmann::json portJson(const PortDesc& p, int32_t paramIndex, const ModuleDescriptor& desc) {
  nlohmann::json j;
  j["id"] = text(p.id);
  j["name"] = text(p.name);
  j["kind"] = kindName(p.kind);
  j["role"] = roleName(p.role);
  j["doc"] = text(p.doc);
  // An implicit port is the one the registry adds for a modulatable param; the UI draws it on the param
  // rather than in the port list, so it has to be able to tell them apart and know which param it feeds.
  j["implicit"] = paramIndex >= 0;
  if (paramIndex >= 0) j["param"] = text(desc.params[paramIndex].id);
  return j;
}

nlohmann::json paramJson(const ParamDesc& p) {
  nlohmann::json j;
  j["id"] = text(p.id);
  j["name"] = text(p.name);
  j["min"] = p.min;
  j["max"] = p.max;
  j["default"] = p.def;
  j["unit"] = unitName(p.unit);
  j["curve"] = curveName(p.curve);
  j["flags"] = {
    {"modulatable", (p.flags & kParamModulatable) != 0},
    {"integer", (p.flags & kParamInteger) != 0},
    {"enum", (p.flags & kParamEnum) != 0},
    {"hidden", (p.flags & kParamHidden) != 0},
    {"noSmooth", (p.flags & kParamNoSmooth) != 0},
    {"structural", (p.flags & kParamStructural) != 0},
    // Whether the module wants this control on its face. The interface shows these without being
    // asked; everything else is reached through the inspector.
    {"primary", (p.flags & kParamPrimary) != 0},
  };
  if (p.enumLabels != nullptr && p.enumCount > 0) {
    std::vector<std::string> labels;
    labels.reserve(p.enumCount);
    for (uint32_t i = 0; i < p.enumCount; ++i) labels.push_back(text(p.enumLabels[i]));
    j["enumLabels"] = labels;
  }
  j["uiWidget"] = text(p.uiWidget);
  if (p.group != nullptr) j["group"] = p.group;
  j["doc"] = text(p.doc);
  return j;
}

/// A text property: the string a module owns and an interface generates an editor for.
nlohmann::json textJson(const TextDesc& t) {
  nlohmann::json j;
  j["id"] = text(t.id);
  j["name"] = text(t.name);
  j["default"] = text(t.def);
  j["flags"] = {{"multiline", (t.flags & kTextMultiline) != 0}};
  // The editor mode to open. Null is plain text, and so is a name the interface has never heard
  // of -- an unknown language should cost syntax colouring, not the ability to type.
  if (t.language != nullptr) j["language"] = text(t.language);
  if (t.placeholder != nullptr) j["placeholder"] = text(t.placeholder);
  j["doc"] = text(t.doc);
  return j;
}

nlohmann::json moduleJson(const RegisteredModule& m) {
  const ModuleDescriptor& d = *m.desc;
  nlohmann::json j;
  j["id"] = text(d.id);
  j["name"] = text(d.name);
  j["category"] = text(d.category);
  j["doc"] = text(d.doc);
  j["flags"] = {
    {"terminal", (d.flags & kModuleTerminal) != 0},
    {"needsTransport", (d.flags & kModuleNeedsTransport) != 0},
    {"writesTelemetry", (d.flags & kModuleWritesTelemetry) != 0},
    {"previewsWave", (d.flags & kModulePreviewsWave) != 0},
    {"previewsEnvelope", (d.flags & kModulePreviewsEnvelope) != 0},
    {"publishesScope", (d.flags & kModulePublishesScope) != 0},
    {"publishesValue", (d.flags & kModulePublishesValue) != 0},
    {"publishesMeter", (d.flags & kModulePublishesMeter) != 0},
    {"publishesNotes", (d.flags & kModulePublishesNotes) != 0},
    {"publishesKeys", (d.flags & kModulePublishesKeys) != 0},
    {"voiceEntry", (d.flags & kModuleVoiceEntry) != 0},
    {"voiceExit", (d.flags & kModuleVoiceExit) != 0},
  };
  // The registry's input list is the declared ports followed by one implicit port per modulatable param,
  // in exactly the order the compiler assigns buffers, so the UI's port indices match the engine's.
  nlohmann::json inputs = nlohmann::json::array();
  for (size_t i = 0; i < m.inputs.size(); ++i) inputs.push_back(portJson(m.inputs[i], m.inputParam[i], d));
  j["inputs"] = inputs;
  nlohmann::json outputs = nlohmann::json::array();
  for (uint32_t i = 0; i < d.numOutputs; ++i) outputs.push_back(portJson(d.outputs[i], -1, d));
  j["outputs"] = outputs;
  nlohmann::json params = nlohmann::json::array();
  for (uint32_t i = 0; i < d.numParams; ++i) params.push_back(paramJson(d.params[i]));
  j["params"] = params;
  nlohmann::json texts = nlohmann::json::array();
  for (uint32_t i = 0; i < d.numTexts; ++i) texts.push_back(textJson(d.texts[i]));
  j["texts"] = texts;
  // The face as the registry padded it: rows of tokens, every row the same length, or null for a module
  // that leaves its face to the interface. See `ModuleDescriptor::face`.
  if (m.face.empty()) j["face"] = nullptr;
  else j["face"] = m.face;
  return j;
}

/// 64-bit FNV-1a over the serialized modules. Content-addressed on purpose: the renderer caches the catalog
/// and only refetches when the hash moves, so it has to change whenever anything a module draws with does.
std::string fnv1a(const std::string& bytes) {
  uint64_t hash = 1469598103934665603ULL;
  for (const char c : bytes) {
    hash ^= static_cast<uint8_t>(c);
    hash *= 1099511628211ULL;
  }
  static const char* kHex = "0123456789abcdef";
  std::string out(16, '0');
  for (int i = 15; i >= 0; --i) {
    out[static_cast<size_t>(i)] = kHex[hash & 0xf];
    hash >>= 4;
  }
  return out;
}

}  // namespace

nlohmann::json catalogJson(const Registry& registry) {
  std::vector<const RegisteredModule*> modules = registry.all();
  std::sort(modules.begin(), modules.end(),
            [](const RegisteredModule* a, const RegisteredModule* b) { return std::string(a->desc->id) < b->desc->id; });

  nlohmann::json list = nlohmann::json::array();
  for (const RegisteredModule* m : modules) list.push_back(moduleJson(*m));

  nlohmann::json out;
  out["catalogHash"] = fnv1a(list.dump());
  // Written as doubles rather than promoted from the engine's floats: `static_cast<double>(261.6256f)` is
  // 261.62560272216797, which is the same pitch but an unreadable document. The asserts keep the two in step.
  static_assert(kMiddleCHz == 261.6256f);
  static_assert(kOctavesPerUnit == 10.f);
  out["conventions"] = {
    {"octavesPerUnit", 10.0},
    {"middleCHz", 261.6256},
    {"gateThreshold", 0},
    {"blockSize", kMaxBlockSize},
    {"lanes", {"v0.L", "v0.R", "v1.L", "v1.R"}},
  };
  out["modules"] = std::move(list);
  return out;
}

}  // namespace pg

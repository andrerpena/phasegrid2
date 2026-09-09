#include "core/Registry.hpp"
#include <algorithm>
#include <map>
#include <set>
#include <utility>
#include "core/Conventions.hpp"

namespace pg {

thread_local const ModuleDescriptor* g_creatingDescriptor = nullptr;

namespace {
/// A modulatable param gets an implicit `param:<id>` input port -- unless it is stepped, because a
/// per-sample continuous modulation signal has no meaning for an integer or enum. Registry::add uses
/// this for BOTH the collision check and the port-creation loop; the two must never drift apart, or a
/// module declaring an explicit `param:<id>` input for a stepped param is rejected for colliding with
/// a port that is never created.
bool hasImplicitPort(const ParamDesc& p) {
  return (p.flags & kParamModulatable) && !(p.flags & (kParamInteger | kParamEnum));
}

/// What one face token names, once resolved against the descriptor.
enum class Cell : uint8_t { Empty, Input, Output, Param, Wave, Scope, Value, Meter };

struct Resolved {
  Cell cell = Cell::Empty;
  int32_t index = -1;   // into the descriptor's inputs, outputs or params
};

int32_t indexOf(const PortDesc* ports, uint32_t count, const std::string& id) {
  for (uint32_t i = 0; i < count; ++i) if (id == ports[i].id) return static_cast<int32_t>(i);
  return -1;
}
int32_t paramIndexOf(const ModuleDescriptor& d, const std::string& id) {
  for (uint32_t i = 0; i < d.numParams; ++i) if (id == d.params[i].id) return static_cast<int32_t>(i);
  return -1;
}

/// Resolves a token, or explains why it cannot be. A bare name may be an input, an output or a param;
/// when it is more than one of those the token has to say which, because a face that silently picked
/// one would draw the wrong thing on the module that happens to call two things `out`.
std::optional<std::string> resolveToken(const ModuleDescriptor& d, const std::string& token, Resolved& out) {
  if (token == ".") { out = {Cell::Empty, -1}; return std::nullopt; }
  if (token == "wave") {
    if (!(d.flags & kModulePreviewsWave)) return "face names `wave` but the module cannot preview one";
    out = {Cell::Wave, -1};
    return std::nullopt;
  }
  if (token == "scope") {
    if (!(d.flags & kModulePublishesScope)) return "face names `scope` but the module does not publish one";
    out = {Cell::Scope, -1};
    return std::nullopt;
  }
  if (token == "value") {
    if (!(d.flags & kModulePublishesValue)) return "face names `value` but the module does not publish one";
    out = {Cell::Value, -1};
    return std::nullopt;
  }
  if (token == "meter") {
    if (!(d.flags & kModulePublishesMeter)) return "face names `meter` but the module does not publish one";
    out = {Cell::Meter, -1};
    return std::nullopt;
  }
  auto prefixed = [&](const char* prefix) -> std::optional<std::string> {
    const std::string p(prefix);
    return token.compare(0, p.size(), p) == 0 ? std::optional<std::string>(token.substr(p.size())) : std::nullopt;
  };
  if (auto id = prefixed("in:")) {
    const int32_t i = indexOf(d.inputs, d.numInputs, *id);
    if (i < 0) return "face names input `" + *id + "`, which the module does not declare";
    out = {Cell::Input, i};
    return std::nullopt;
  }
  if (auto id = prefixed("out:")) {
    const int32_t i = indexOf(d.outputs, d.numOutputs, *id);
    if (i < 0) return "face names output `" + *id + "`, which the module does not declare";
    out = {Cell::Output, i};
    return std::nullopt;
  }
  if (auto id = prefixed("param:")) {
    const int32_t i = paramIndexOf(d, *id);
    if (i < 0) return "face names param `" + *id + "`, which the module does not declare";
    out = {Cell::Param, i};
    return std::nullopt;
  }
  const int32_t in = indexOf(d.inputs, d.numInputs, token);
  const int32_t o = indexOf(d.outputs, d.numOutputs, token);
  const int32_t p = paramIndexOf(d, token);
  const int matches = (in >= 0) + (o >= 0) + (p >= 0);
  if (matches == 0) return "face token `" + token + "` names nothing on the module";
  if (matches > 1) return "face token `" + token + "` is ambiguous: say in:, out: or param:";
  if (in >= 0) out = {Cell::Input, in};
  else if (o >= 0) out = {Cell::Output, o};
  else out = {Cell::Param, p};
  return std::nullopt;
}

/// Splits a row on whitespace.
std::vector<std::string> tokenise(const char* row) {
  std::vector<std::string> out;
  std::string current;
  for (const char* c = row ? row : ""; *c; ++c) {
    if (*c == ' ' || *c == '\t') {
      if (!current.empty()) { out.push_back(current); current.clear(); }
    } else {
      current.push_back(*c);
    }
  }
  if (!current.empty()) out.push_back(current);
  return out;
}

/**
 * Checks a declared face against the rules in `Descriptor.hpp` and, when it passes, hands back the grid
 * padded to a rectangle. The geometric rule is CSS `grid-template-areas`': every distinct token's cells
 * must fill their own bounding box, so a block is always a rectangle.
 */
std::optional<std::string> validateFace(const ModuleDescriptor& d, std::vector<std::vector<std::string>>& grid) {
  grid.clear();
  if (d.face == nullptr || d.faceRows == 0) {
    if (d.face != nullptr || d.faceRows != 0) return "face and faceRows disagree";
    return std::nullopt;
  }
  if (d.faceRows > kMaxFaceRows) return "face has too many rows";
  size_t cols = 0;
  for (uint32_t r = 0; r < d.faceRows; ++r) {
    grid.push_back(tokenise(d.face[r]));
    cols = std::max(cols, grid.back().size());
  }
  if (cols == 0) return "face has no cells";
  if (cols > kMaxFaceCols) return "face is too wide";
  for (auto& row : grid) row.resize(cols, ".");

  struct Area { int minR, minC, maxR, maxC; int count; Resolved what; };
  std::map<std::string, Area> areas;
  for (int r = 0; r < static_cast<int>(grid.size()); ++r) {
    for (int c = 0; c < static_cast<int>(cols); ++c) {
      const std::string& token = grid[static_cast<size_t>(r)][static_cast<size_t>(c)];
      Resolved what;
      if (auto err = resolveToken(d, token, what)) return *err;
      if (what.cell == Cell::Empty) continue;
      auto it = areas.find(token);
      if (it == areas.end()) areas.emplace(token, Area{r, c, r, c, 1, what});
      else {
        Area& a = it->second;
        a.minR = std::min(a.minR, r); a.minC = std::min(a.minC, c);
        a.maxR = std::max(a.maxR, r); a.maxC = std::max(a.maxC, c);
        ++a.count;
      }
    }
  }

  // Two spellings of one thing (`out` and `out:out`) would be two blocks for one port.
  std::set<std::pair<Cell, int32_t>> seen;
  for (const auto& [token, a] : areas) {
    const int h = a.maxR - a.minR + 1, w = a.maxC - a.minC + 1;
    if (a.count != h * w) return "face block `" + token + "` is not a rectangle";
    if (!seen.insert({a.what.cell, a.what.index}).second) return "face names `" + token + "` twice";
    if (a.what.cell == Cell::Param) {
      const ParamDesc& p = d.params[a.what.index];
      if (p.flags & kParamHidden) return "face shows hidden param `" + token + "`";
      if (p.flags & kParamEnum) return "face shows enum param `" + token + "`, which has no block yet";
      if (h < 2 || w < 2) return "face gives `" + token + "` less than two cells by two";
    }
    if (a.what.cell == Cell::Wave && (h < 2 || w < 2)) return "face gives `wave` less than two cells by two";
    if (a.what.cell == Cell::Scope && (h < 2 || w < 2)) return "face gives `scope` less than two cells by two";
    // A readout is a line of text: it needs width for the digits but reads fine one cell tall.
    if (a.what.cell == Cell::Value && w < 2) return "face gives `value` less than two cells across";
    if (a.what.cell == Cell::Meter && (h < 2 || w < 2)) return "face gives `meter` less than two cells by two";
  }
  for (uint32_t i = 0; i < d.numInputs; ++i)
    if (!seen.contains({Cell::Input, static_cast<int32_t>(i)})) return std::string("face leaves out input `") + d.inputs[i].id + "`";
  for (uint32_t i = 0; i < d.numOutputs; ++i)
    if (!seen.contains({Cell::Output, static_cast<int32_t>(i)})) return std::string("face leaves out output `") + d.outputs[i].id + "`";
  return std::nullopt;
}
}  // namespace

int32_t RegisteredModule::findInput(std::string_view id) const {
  for (size_t i = 0; i < inputs.size(); ++i) if (id == inputs[i].id) return static_cast<int32_t>(i);
  return -1;
}
int32_t RegisteredModule::findOutput(std::string_view id) const {
  for (uint32_t i = 0; i < desc->numOutputs; ++i) if (id == desc->outputs[i].id) return static_cast<int32_t>(i);
  return -1;
}
int32_t RegisteredModule::findParam(std::string_view id) const {
  for (uint32_t i = 0; i < desc->numParams; ++i) if (id == desc->params[i].id) return static_cast<int32_t>(i);
  return -1;
}

std::optional<std::string> Registry::add(const ModuleDescriptor& d) {
  const std::string id = d.id ? d.id : "";
  if (id.empty()) return "descriptor has no id";
  if (d.abiVersion != kModuleAbiVersion) return id + ": abi version mismatch";
  if (byId_.contains(id)) return id + ": duplicate module id";
  if (d.numInputs + d.numParams > kMaxPortsPerModule || d.numOutputs > kMaxPortsPerModule) return id + ": too many ports";
  if (d.numParams > kMaxParamsPerModule) return id + ": too many params";
  if (!d.create) return id + ": missing create()";
  // A scope is a kind of telemetry the module writes itself; a module claiming one without a slot to
  // write it into would get a panel that never shows anything.
  if ((d.flags & kModulePublishesScope) && !(d.flags & kModuleWritesTelemetry))
    return id + ": publishes a scope but does not write telemetry";
  if ((d.flags & kModulePublishesValue) && !(d.flags & kModuleWritesTelemetry))
    return id + ": publishes a value but does not write telemetry";
  if ((d.flags & kModulePublishesMeter) && !(d.flags & kModuleWritesTelemetry))
    return id + ": publishes a meter but does not write telemetry";

  std::set<std::string> ids;
  for (uint32_t i = 0; i < d.numInputs; ++i)
    if (!ids.insert(d.inputs[i].id).second) return id + ": duplicate input id " + d.inputs[i].id;
  ids.clear();
  for (uint32_t i = 0; i < d.numOutputs; ++i)
    if (!ids.insert(d.outputs[i].id).second) return id + ": duplicate output id " + d.outputs[i].id;
  ids.clear();
  for (uint32_t i = 0; i < d.numParams; ++i) {
    const ParamDesc& p = d.params[i];
    if (!ids.insert(p.id).second) return id + ": duplicate param id " + p.id;
    if (!(p.min < p.max)) return id + ": param " + p.id + " needs min < max";
    if (p.curve == ParamCurve::Log && p.min <= 0.f) return id + ": log param " + p.id + " needs min > 0";
    if ((p.flags & kParamEnum) && (p.enumLabels == nullptr || p.enumCount == 0)) return id + ": enum param " + p.id + " has no labels";
    // A structural param is read once, on the message thread, while the instance is being built; a per-sample
    // modulation signal has nowhere to go. Rejecting the combination keeps that impossible instead of silent.
    if ((p.flags & kParamStructural) && (p.flags & kParamModulatable))
      return id + ": structural param " + p.id + " cannot be modulatable";
    if (hasImplicitPort(p)) {
      const std::string implicitId = "param:" + std::string(p.id);
      for (uint32_t k = 0; k < d.numInputs; ++k) if (implicitId == d.inputs[k].id) return id + ": input collides with implicit port " + implicitId;
    }
  }

  auto rm = std::make_unique<RegisteredModule>();
  rm->desc = &d;
  if (auto err = validateFace(d, rm->face)) return id + ": " + *err;
  for (uint32_t i = 0; i < d.numInputs; ++i) { rm->inputs.push_back(d.inputs[i]); rm->inputParam.push_back(-1); }
  for (uint32_t i = 0; i < d.numParams; ++i) {
    const ParamDesc& p = d.params[i];
    if (!hasImplicitPort(p)) continue;
    rm->implicitIds.push_back("param:" + std::string(p.id));
    rm->inputs.push_back(PortDesc{rm->implicitIds.back().c_str(), p.name, PortKind::Continuous, 1, SignalRole::Cv, p.doc});
    rm->inputParam.push_back(static_cast<int32_t>(i));
  }
  byId_.emplace(id, std::move(rm));
  return std::nullopt;
}

const RegisteredModule* Registry::find(std::string_view typeId) const {
  auto it = byId_.find(typeId);
  return it == byId_.end() ? nullptr : it->second.get();
}

std::vector<const RegisteredModule*> Registry::all() const {
  std::vector<const RegisteredModule*> out;
  for (const auto& [k, v] : byId_) out.push_back(v.get());
  return out;
}

}  // namespace pg

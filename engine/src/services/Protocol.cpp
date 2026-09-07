#include "services/Protocol.hpp"
#include <cmath>
#include <utility>
#include "core/Version.hpp"
#include "render/PatchFile.hpp"
#include "services/Catalog.hpp"

namespace pg {
namespace {

using nlohmann::json;

const json& emptyObject() {
  static const json kEmpty = json::object();
  return kEmpty;
}

json okResponse(const json& id, json result) {
  json r = json::object();
  r["id"] = id;
  r["ok"] = true;
  r["result"] = std::move(result);
  return r;
}

json errorResponse(const json& id, const std::string& code, const std::string& message) {
  json r = json::object();
  r["id"] = id;
  r["ok"] = false;
  r["error"] = json{{"code", code}, {"message", message}};
  return r;
}

json errorResponse(const json& id, const Result& failure) {
  return errorResponse(id, failure.code, failure.message);
}

/// Pulls arguments out of a request and remembers the first one that was missing or the wrong type, so a
/// handler can read everything it needs and check once instead of after every field. A failed read yields
/// a harmless default, which is why reading on after a failure is safe.
class ArgReader {
public:
  explicit ArgReader(const json& args) : args_(args.is_object() ? args : emptyObject()) {
    if (!args.is_object() && !args.is_null()) error_ = Result::fail("E_SCHEMA", "args must be an object");
  }

  std::string str(const char* key) {
    const json* v = get(key);
    if (v == nullptr) return fail(key, "a string");
    if (!v->is_string()) return fail(key, "a string");
    std::string s = v->get<std::string>();
    if (s.empty()) return fail(key, "a non-empty string");
    return s;
  }

  std::string str(const char* key, std::string fallback) {
    const json* v = get(key);
    if (v == nullptr) return fallback;
    if (!v->is_string()) return fail(key, "a string");
    return v->get<std::string>();
  }

  double num(const char* key) {
    const json* v = get(key);
    if (v == nullptr || !v->is_number()) { fail(key, "a number"); return 0.0; }
    return v->get<double>();
  }

  double num(const char* key, double fallback) {
    const json* v = get(key);
    if (v == nullptr) return fallback;
    if (!v->is_number()) { fail(key, "a number"); return fallback; }
    return v->get<double>();
  }

  bool flag(const char* key, bool fallback) {
    const json* v = get(key);
    if (v == nullptr) return fallback;
    if (!v->is_boolean()) { fail(key, "a boolean"); return fallback; }
    return v->get<bool>();
  }

  /// An object argument. Absent is an empty object unless `required`.
  const json& obj(const char* key, bool required = false) {
    const json* v = get(key);
    if (v == nullptr) {
      if (required) fail(key, "an object");
      return emptyObject();
    }
    if (!v->is_object()) { fail(key, "an object"); return emptyObject(); }
    return *v;
  }

  const json& arr(const char* key) {
    static const json kEmptyArray = json::array();
    const json* v = get(key);
    if (v == nullptr || !v->is_array()) { fail(key, "an array"); return kEmptyArray; }
    return *v;
  }

  const Result& result() const { return error_; }
  explicit operator bool() const { return error_.ok; }

private:
  const json* get(const char* key) const {
    const auto it = args_.find(key);
    return it == args_.end() || it->is_null() ? nullptr : &*it;
  }

  std::string fail(const char* key, const char* expected) {
    if (error_.ok) error_ = Result::fail("E_SCHEMA", std::string(key) + " must be " + expected);
    return {};
  }

  const json& args_;
  Result error_;
};

/// Numbers only. Anything a param cannot express is structured `data` the module owns.
Result readParams(const json& params, ParamValues& out) {
  if (!params.is_object()) return Result::fail("E_SCHEMA", "params must be an object");
  for (const auto& [key, value] : params.items()) {
    if (!value.is_number()) return Result::fail("E_SCHEMA", "param " + key + " must be a number");
    out[key] = value.get<float>();
  }
  return {};
}

// ---------------------------------------------------------------------------------------------------
// Patch ops. `shared/protocol/patch.ts` is the other half of this table: the discriminated union there
// and the switch here have to agree, and `test_protocol.cpp` walks every arm.

Result applyModuleAdd(GraphModel& model, const Registry& registry, const json& o) {
  ArgReader a(o);
  NodeModel node;
  node.id = a.str("id");
  node.type = a.str("type");
  const json& params = a.obj("params");
  const json& data = a.obj("data");
  if (!a) return a.result();
  if (Result r = readParams(params, node.params); !r) return r;
  node.data = data;   // shape is the module's business; `addNode` is the one gate on it
  return model.addNode(registry, std::move(node));
}

Result applyModuleRemove(GraphModel& model, const json& o) {
  ArgReader a(o);
  const std::string id = a.str("id");
  if (!a) return a.result();
  return model.removeNode(id);
}

Result applyEdgeAdd(GraphModel& model, const Registry& registry, const json& o) {
  ArgReader a(o);
  EdgeModel edge;
  edge.id = a.str("id");
  const json& from = a.obj("from", true);
  const json& to = a.obj("to", true);
  if (!a) return a.result();
  ArgReader f(from), t(to);
  edge.fromNode = f.str("module");
  edge.fromPort = f.str("port");
  edge.toNode = t.str("module");
  edge.toPort = t.str("port");
  if (!f) return f.result();
  if (!t) return t.result();
  return model.addEdge(registry, std::move(edge));
}

Result applyEdgeRemove(GraphModel& model, const json& o) {
  ArgReader a(o);
  const std::string id = a.str("id");
  if (!a) return a.result();
  return model.removeEdge(id);
}

Result applyParamSet(GraphModel& model, const Registry& registry, const json& o) {
  ArgReader a(o);
  const std::string node = a.str("module");
  const std::string param = a.str("param");
  const double value = a.num("value");
  if (!a) return a.result();
  return model.setParam(registry, node, param, static_cast<float>(value));
}

Result applySetVoiceCount(GraphModel& model, const json& o) {
  ArgReader a(o);
  const double n = a.num("voiceCount");
  if (!a) return a.result();
  if (n < 1.0 || n > 64.0 || n != static_cast<double>(static_cast<uint32_t>(n)))
    return Result::fail("E_VOICES", "voiceCount must be a whole number 1..64");
  return model.setVoiceCount(static_cast<uint32_t>(n));
}

Result applyOp(GraphModel& model, const Registry& registry, const json& op) {
  if (!op.is_object()) return Result::fail("E_SCHEMA", "an op must be an object");
  const auto kind = op.find("op");
  if (kind == op.end() || !kind->is_string()) return Result::fail("E_SCHEMA", "an op needs a string `op`");
  const std::string name = kind->get<std::string>();
  if (name == "moduleAdd") return applyModuleAdd(model, registry, op);
  if (name == "moduleRemove") return applyModuleRemove(model, op);
  if (name == "edgeAdd") return applyEdgeAdd(model, registry, op);
  if (name == "edgeRemove") return applyEdgeRemove(model, op);
  if (name == "paramSet") return applyParamSet(model, registry, op);
  if (name == "setVoiceCount") return applySetVoiceCount(model, op);
  // Layout, not signal. Engine sync drops it before sending; a client that forgets should not have its
  // whole batch rejected over where a node is drawn, so it is accepted and does nothing here.
  if (name == "moduleMove") return {};
  return Result::fail("E_SCHEMA", "unknown patch op: " + name);
}

// ---------------------------------------------------------------------------------------------------

/// Every graph edit, atomically (trap 5). The edit runs against a copy; only a copy that survived every
/// op is moved into place, and only a commit that succeeded is kept. A failure anywhere leaves the model
/// byte-for-byte as it was and the previous program still playing.
template <class Edit>
json editGraph(ProtocolContext& ctx, const json& id, Edit&& edit) {
  GraphModel fresh = ctx.engine.model();   // a copy, so a half-applied edit is never observable
  if (Result r = edit(fresh); !r) return errorResponse(id, r);

  GraphModel previous = ctx.engine.model();
  ctx.engine.model() = std::move(fresh);
  if (Result r = ctx.engine.commit(); !r) {
    ctx.engine.model() = std::move(previous);
    return errorResponse(id, r);
  }
  const uint64_t revision = ctx.engine.revision();
  ctx.events.push_back({"patch.revision", json{{"revision", revision}}});
  return okResponse(id, json{{"revision", revision}});
}

}  // namespace

nlohmann::json transportPositionJson(const Transport& transport) {
  const TransportSnapshot t = transport.state();
  // `bar` and `beat` are derived rather than stored: `ppq` plus the meter is the whole truth, and two
  // fields that can disagree with it would be two more chances to be wrong.
  const double quartersPerBar = t.quartersPerBar();
  const double bars = quartersPerBar > 0.0 ? t.ppq / quartersPerBar : 0.0;
  return json{{"playing", t.playing},
              {"tempo", t.tempo},
              {"ppq", t.ppq},
              {"samplePos", t.samplePos},
              {"timeSigNumerator", t.timeSigNumerator},
              {"timeSigDenominator", t.timeSigDenominator},
              {"bar", static_cast<uint64_t>(bars < 0.0 ? 0.0 : bars)},
              {"beat", (t.ppq - std::floor(bars) * quartersPerBar) / t.quartersPerBeat()}};
}

namespace {

json positionJson(const Transport& transport) { return transportPositionJson(transport); }

json deviceListJson(DeviceHost& host) {
  json devices = json::array();
  for (const DeviceInfo& d : host.devices())
    devices.push_back(json{{"backend", host.backendName()}, {"id", d.id}, {"name", d.name}, {"isDefault", d.isDefault}});
  return json{{"devices", std::move(devices)},
              {"current", host.currentId()},
              {"sampleRate", host.sampleRate()},
              {"channels", host.channels()}};
}

json helloJson(ProtocolContext& ctx) {
  const json catalog = catalogJson(ctx.registry);
  json capabilities = json::array({"patch", "transport"});
  if (ctx.device != nullptr) capabilities.push_back("device");
  if (ctx.telemetry != nullptr && ctx.telemetry->valid()) capabilities.push_back("telemetry");
  // Still no "midi": that command has no handler, and a capability for a command the engine cannot
  // answer is worse than no capability at all.
  json result;
  result["protocolVersion"] = kProtocolVersion;
  result["engineVersion"] = engineVersion();
  result["catalogHash"] = catalog["catalogHash"];
  result["conventions"] = catalog["conventions"];
  // The segment, when there is one. A client needs the name and the size to map it, and the layout
  // version to refuse a segment it does not know how to read.
  if (ctx.telemetry != nullptr && ctx.telemetry->valid())
    // Name, size and layout version: exactly what it takes to map the segment and refuse one whose
    // layout this client does not know. The slot count is deliberately not here -- it is in the segment
    // header, which a reader validates anyway, and one fact in two places is one fact that can disagree.
    result["shm"] = json{{"name", ctx.telemetry->name()},
                         {"size", ctx.telemetry->byteLength()},
                         {"layoutVersion", kTelemetryLayoutVersion}};
  else
    result["shm"] = nullptr;
  result["capabilities"] = std::move(capabilities);
  return result;
}

json dispatchCommand(const std::string& cmd, const json& id, const json& args, ProtocolContext& ctx) {
  // ---- engine
  if (cmd == "hello") {
    ArgReader a(args);
    const double version = a.num("protocolVersion");
    if (!a) return errorResponse(id, a.result());
    if (static_cast<int>(version) != kProtocolVersion)
      return errorResponse(id, "E_VERSION",
                           "engine speaks protocol " + std::to_string(kProtocolVersion) + ", client asked for " +
                               std::to_string(static_cast<int>(version)));
    return okResponse(id, helloJson(ctx));
  }
  if (cmd == "engine.ping") return okResponse(id, json{{"pong", true}, {"revision", ctx.engine.revision()}});
  if (cmd == "engine.shutdown") {
    ctx.shutdownRequested = true;   // answered first, then the caller closes: a clean exit, not a crash
    return okResponse(id, json::object());
  }
  if (cmd == "catalog.get") return okResponse(id, catalogJson(ctx.registry));

  // ---- telemetry
  //
  // Slots are handed out here rather than by the compiler, so subscribing never recompiles the graph and
  // cannot glitch the audio. The map goes back in the reply; a client never infers it from the segment,
  // which carries no module names at all.
  if (cmd == "telemetry.subscribe") {
    if (ctx.telemetry == nullptr || !ctx.telemetry->valid())
      return errorResponse(id, "E_UNSUPPORTED", "this engine has no telemetry segment");
    ArgReader a(args);
    const json& modules = a.arr("modules");
    if (!a) return errorResponse(id, a.result());

    // Assign against a copy and only publish it if every module resolves, so a request naming one bad
    // module leaves every existing subscription exactly as it was.
    std::vector<std::string> wanted;
    for (const json& m : modules) {
      if (!m.is_string()) return errorResponse(id, "E_SCHEMA", "modules must be strings");
      wanted.push_back(m.get<std::string>());
    }
    if (wanted.size() > ctx.telemetry->slotCount())
      return errorResponse(id, "E_NO_SLOTS",
                           "asked for " + std::to_string(wanted.size()) + " slots, segment has " +
                               std::to_string(ctx.telemetry->slotCount()));
    for (const std::string& moduleId : wanted)
      if (!ctx.engine.hasInstance(moduleId))
        return errorResponse(id, "E_NODE_NOT_FOUND", "no module " + moduleId);

    // Every previous subscription is dropped first: the request is the whole set, not an addition, so a
    // module the interface stopped watching stops writing rather than lingering in a slot forever.
    ctx.engine.clearTelemetrySlots();
    json slots = json::object();
    for (uint32_t i = 0; i < wanted.size(); ++i) {
      ctx.engine.setTelemetrySlot(wanted[i], i);
      slots[wanted[i]] = i;
    }
    return okResponse(id, json{{"slots", std::move(slots)}});
  }
  /// One cycle of a module's waveform at its current values, for the face to draw. Read from the model
  /// and the instance on this thread; the audio thread is not involved, so asking costs no glitch.
  if (cmd == "module.preview") {
    ArgReader a(args);
    const std::string node = a.str("module");
    const double requested = a.num("count", 256.0);
    if (!a) return errorResponse(id, a.result());
    const uint32_t count = static_cast<uint32_t>(std::min(2048.0, std::max(16.0, requested)));
    std::vector<float> samples(count);
    if (Result r = ctx.engine.preview(node, samples.data(), count); !r) return errorResponse(id, r);
    return okResponse(id, json{{"samples", samples}});
  }
  if (cmd == "telemetry.unsubscribe") {
    if (ctx.telemetry != nullptr) ctx.engine.clearTelemetrySlots();
    return okResponse(id, json::object());
  }

  // ---- patch
  if (cmd == "patch.load") {
    ArgReader a(args);
    const json& patch = a.obj("patch", true);
    if (!a) return errorResponse(id, a.result());
    return editGraph(ctx, id, [&](GraphModel& model) { return loadPatchJson(patch, ctx.registry, model); });
  }
  if (cmd == "patch.clear")
    return editGraph(ctx, id, [](GraphModel& model) { model.clear(); return Result{}; });
  if (cmd == "patch.batch") {
    ArgReader a(args);
    const json& ops = a.arr("ops");
    if (!a) return errorResponse(id, a.result());
    return editGraph(ctx, id, [&](GraphModel& model) {
      for (const json& op : ops)
        if (Result r = applyOp(model, ctx.registry, op); !r) return r;
      return Result{};
    });
  }
  if (cmd == "patch.setVoiceCount")
    return editGraph(ctx, id, [&](GraphModel& model) { return applySetVoiceCount(model, args); });
  if (cmd == "patch.setFeedbackMode") {
    ArgReader a(args);
    const std::string mode = a.str("mode");
    if (!a) return errorResponse(id, a.result());
    if (mode != "sample" && mode != "block") return errorResponse(id, "E_SCHEMA", "mode must be sample|block");
    return editGraph(ctx, id, [&](GraphModel& model) {
      model.feedbackMode = mode == "block" ? FeedbackMode::Block : FeedbackMode::Sample;
      return Result{};
    });
  }

  // ---- graph edits, each one a batch of exactly one op
  if (cmd == "module.add")
    return editGraph(ctx, id, [&](GraphModel& model) { return applyModuleAdd(model, ctx.registry, args); });
  if (cmd == "module.remove")
    return editGraph(ctx, id, [&](GraphModel& model) { return applyModuleRemove(model, args); });
  if (cmd == "edge.add")
    return editGraph(ctx, id, [&](GraphModel& model) { return applyEdgeAdd(model, ctx.registry, args); });
  if (cmd == "edge.remove")
    return editGraph(ctx, id, [&](GraphModel& model) { return applyEdgeRemove(model, args); });

  if (cmd == "param.set") {
    ArgReader a(args);
    const std::string node = a.str("module");
    const std::string param = a.str("param");
    const double value = a.num("value");
    const bool transient = a.flag("transient", false);
    if (!a) return errorResponse(id, a.result());

    // The cheap path: `Engine::setParam` writes the document and hands the audio thread a smoothed
    // target through the param queue, so a knob can be dragged without recompiling anything.
    if (Result r = ctx.engine.setParam(node, param, static_cast<float>(value)); !r) return errorResponse(id, r);

    // A structural param is the exception: `configure` reads it once, before `prepare`, so the only way
    // to apply one is to build the instance again -- which is a commit. Mid-gesture (`transient`) that
    // rebuild is skipped, and the value lands when the gesture ends with a non-transient set.
    bool structural = false;
    const auto node_it = ctx.engine.model().nodes().find(node);
    if (node_it != ctx.engine.model().nodes().end()) {
      if (const RegisteredModule* type = ctx.registry.find(node_it->second.type)) {
        const int32_t index = type->findParam(param);
        if (index >= 0) structural = (type->desc->params[index].flags & kParamStructural) != 0;
      }
    }
    if (structural && !transient) {
      if (Result r = ctx.engine.commit(); !r) return errorResponse(id, r);
      ctx.events.push_back({"patch.revision", json{{"revision", ctx.engine.revision()}}});
    }
    return okResponse(id, json{{"revision", ctx.engine.revision()}});
  }

  // ---- transport
  if (cmd == "transport.play") { ctx.transport.play(); return okResponse(id, positionJson(ctx.transport)); }
  // The master output level: the way to make a patch stop, since a modular graph is not gated by the
  // transport and an oscillator wired to the output drones whether or not the clock is running.
  if (cmd == "audio.setOutputGain") {
    ArgReader a(args);
    const double gain = a.num("gain");
    if (!a) return errorResponse(id, a.result());
    if (!(gain >= 0.0 && gain <= 1.0))
      return errorResponse(id, "E_SCHEMA", "gain must be between 0 and 1");
    ctx.engine.setOutputGain(static_cast<float>(gain));
    return okResponse(id, json{{"gain", ctx.engine.outputGain()}});
  }
  if (cmd == "transport.stop") { ctx.transport.stop(); return okResponse(id, positionJson(ctx.transport)); }
  if (cmd == "transport.setTempo") {
    ArgReader a(args);
    const double tempo = a.num("tempo");
    if (!a) return errorResponse(id, a.result());
    if (Result r = ctx.transport.setTempo(tempo); !r) return errorResponse(id, r);
    return okResponse(id, positionJson(ctx.transport));
  }
  if (cmd == "transport.setTimeSignature") {
    ArgReader a(args);
    const double numerator = a.num("numerator");
    const double denominator = a.num("denominator");
    if (!a) return errorResponse(id, a.result());
    if (Result r = ctx.transport.setTimeSignature(static_cast<uint32_t>(numerator), static_cast<uint32_t>(denominator)); !r)
      return errorResponse(id, r);
    return okResponse(id, positionJson(ctx.transport));
  }
  if (cmd == "transport.seek") {
    ArgReader a(args);
    const double ppq = a.num("ppq");
    if (!a) return errorResponse(id, a.result());
    if (Result r = ctx.transport.seek(ppq); !r) return errorResponse(id, r);
    return okResponse(id, positionJson(ctx.transport));
  }

  // ---- device
  if (cmd == "device.list" || cmd == "device.select") {
    if (ctx.device == nullptr) return errorResponse(id, "E_NOT_FOUND", "this engine process has no audio device");
    if (cmd == "device.list") return okResponse(id, deviceListJson(*ctx.device));
    ArgReader a(args);
    const std::string wanted = a.str("id", "");   // empty selects the system default
    if (!a) return errorResponse(id, a.result());
    if (Result r = ctx.device->select(wanted); !r) return errorResponse(id, r);
    json list = deviceListJson(*ctx.device);
    ctx.events.push_back({"device.changed", list});
    return okResponse(id, std::move(list));
  }

  return errorResponse(id, "E_UNKNOWN_CMD", "unknown command: " + cmd);
}

}  // namespace

nlohmann::json dispatch(const nlohmann::json& request, ProtocolContext& ctx) {
  json id = nullptr;
  try {
    if (!request.is_object()) return errorResponse(id, "E_SCHEMA", "a request must be an object");
    if (const auto it = request.find("id"); it != request.end() && (it->is_number() || it->is_string())) id = *it;
    const auto cmd = request.find("cmd");
    if (cmd == request.end() || !cmd->is_string() || cmd->get<std::string>().empty())
      return errorResponse(id, "E_SCHEMA", "a request needs a non-empty string `cmd`");
    if (id.is_null()) return errorResponse(id, "E_SCHEMA", "a request needs a number or string `id`");
    const auto args = request.find("args");
    // Checked here rather than in `ArgReader`, because a command that reads no arguments must reject a
    // malformed `args` just as loudly as one that reads them all.
    if (args != request.end() && !args->is_null() && !args->is_object())
      return errorResponse(id, "E_SCHEMA", "args must be an object");
    return dispatchCommand(cmd->get<std::string>(), id, args == request.end() ? emptyObject() : *args, ctx);
  } catch (const nlohmann::json::exception& e) {
    // Every accessor above can throw on an unexpected node type. The explicit checks cover the shapes a
    // client actually hits, with a message worth reading; this is the backstop that keeps a malformed
    // message from taking down an engine that is holding the audio device.
    return errorResponse(id, "E_SCHEMA", e.what());
  }
}

std::string dispatchLine(std::string_view line, ProtocolContext& ctx) {
  const json request = json::parse(line, nullptr, false);
  if (request.is_discarded()) return errorResponse(nullptr, "E_SCHEMA", "invalid JSON").dump() + "\n";
  return dispatch(request, ctx).dump() + "\n";
}

nlohmann::json encodeEvent(const ProtocolEvent& event, uint64_t seq) {
  json e = json::object();
  e["event"] = event.name;
  e["seq"] = seq;
  e["data"] = event.data;
  return e;
}

}  // namespace pg

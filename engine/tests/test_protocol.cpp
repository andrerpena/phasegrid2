#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <string>
#include <vector>
#include "core/Version.hpp"
#include "modules/TestModules.hpp"
#include "modules/builtin.hpp"
#include "services/Catalog.hpp"
#include "services/Protocol.hpp"
#include "util/RtGuard.hpp"

using nlohmann::json;

namespace {

/// An engine, a registry of test modules and a context, which is everything `dispatch` can touch.
/// No socket, no thread: the whole protocol is exercised as the pure function it is.
struct Fixture {
  pg::Registry registry;
  pg::Engine engine{registry, pg::EngineConfig{48000.0, 64}};
  pg::Transport transport;
  pg::ProtocolContext ctx{engine, registry, transport, nullptr, {}, false};

  Fixture() { pg::test::registerTestModules(registry); }

  json call(const std::string& cmd, json args = json::object(), json id = 1) {
    ctx.events.clear();
    json request = json::object();
    request["id"] = std::move(id);
    request["cmd"] = cmd;
    request["args"] = std::move(args);
    return pg::dispatch(request, ctx);
  }

  /// const -> gain -> sink, committed. The smallest graph that actually compiles and renders.
  void buildWorkingPatch() {
    REQUIRE(call("module.add", json{{"id", "src"}, {"type", "test.const"}, {"params", {{"value", 0.5}}}})["ok"] == true);
    REQUIRE(call("module.add", json{{"id", "amp"}, {"type", "test.gain"}})["ok"] == true);
    REQUIRE(call("module.add", json{{"id", "out"}, {"type", "test.sink"}})["ok"] == true);
    REQUIRE(call("edge.add", json{{"id", "e1"},
                                  {"from", {{"module", "src"}, {"port", "out"}}},
                                  {"to", {{"module", "amp"}, {"port", "in"}}}})["ok"] == true);
    REQUIRE(call("edge.add", json{{"id", "e2"},
                                  {"from", {{"module", "amp"}, {"port", "out"}}},
                                  {"to", {{"module", "out"}, {"port", "in"}}}})["ok"] == true);
  }

  size_t nodeCount() { return engine.model().nodes().size(); }
  size_t edgeCount() { return engine.model().edges().size(); }
  uint64_t revision() const { return engine.revision(); }
  bool emitted(const std::string& name) const {
    for (const pg::ProtocolEvent& e : ctx.events)
      if (e.name == name) return true;
    return false;
  }
};

std::string errorCode(const json& response) {
  REQUIRE(response.contains("error"));
  return response["error"]["code"].get<std::string>();
}

/// A device that exists only in this test: two devices, no audio, and a record of what was selected.
class FakeDeviceHost final : public pg::DeviceHost {
public:
  std::string backendName() const override { return "fake"; }
  std::vector<pg::DeviceInfo> devices() override {
    return {{"dev-a", "Device A", true}, {"dev-b", "Device B", false}};
  }
  std::string currentId() const override { return current_; }
  double sampleRate() const override { return 48000.0; }
  uint32_t channels() const override { return 2; }
  pg::Result select(const std::string& id) override {
    if (!id.empty() && id != "dev-a" && id != "dev-b") return pg::Result::fail("E_NOT_FOUND", "no device " + id);
    current_ = id;
    return {};
  }

private:
  std::string current_;
};

}  // namespace

TEST_CASE("hello reports this build's protocol version, engine version and catalog hash", "[protocol]") {
  pg::Registry registry;
  pg::registerBuiltinModules(registry);
  pg::Engine engine{registry, pg::EngineConfig{48000.0, 64}};
  pg::Transport transport;
  pg::ProtocolContext ctx{engine, registry, transport, nullptr, {}, false};

  const json response = pg::dispatch(json{{"id", 1}, {"cmd", "hello"}, {"args", {{"protocolVersion", 1}}}}, ctx);
  REQUIRE(response["ok"] == true);
  const json& result = response["result"];
  REQUIRE(result["protocolVersion"] == pg::kProtocolVersion);
  REQUIRE(result["engineVersion"] == pg::engineVersion());
  // The real hash of the real catalog, not a placeholder: the interface caches by it.
  REQUIRE(result["catalogHash"] == pg::catalogJson(registry)["catalogHash"]);
  REQUIRE(result["conventions"]["blockSize"] == pg::kMaxBlockSize);
  REQUIRE(result["shm"].is_null());   // phase 5 opens the segment
  const auto capabilities = result["capabilities"].get<std::vector<std::string>>();
  REQUIRE_FALSE(capabilities.empty());
  for (const std::string& c : capabilities) REQUIRE((c != "telemetry" && c != "midi"));
}

TEST_CASE("hello refuses a protocol version this engine cannot speak", "[protocol]") {
  Fixture f;
  const json refused = f.call("hello", json{{"protocolVersion", pg::kProtocolVersion + 1}});
  REQUIRE(refused["ok"] == false);
  REQUIRE(errorCode(refused) == "E_VERSION");
  REQUIRE(errorCode(f.call("hello", json::object())) == "E_SCHEMA");
  REQUIRE(errorCode(f.call("hello", json{{"protocolVersion", "one"}})) == "E_SCHEMA");
}

TEST_CASE("hello names the audio device as a capability only when there is one", "[protocol]") {
  Fixture f;
  const auto without = f.call("hello", json{{"protocolVersion", 1}})["result"]["capabilities"].get<std::vector<std::string>>();
  REQUIRE(std::find(without.begin(), without.end(), "device") == without.end());
  FakeDeviceHost host;
  f.ctx.device = &host;
  const auto with = f.call("hello", json{{"protocolVersion", 1}})["result"]["capabilities"].get<std::vector<std::string>>();
  REQUIRE(std::find(with.begin(), with.end(), "device") != with.end());
}

TEST_CASE("an unknown command is an error, not a throw", "[protocol]") {
  Fixture f;
  const json response = f.call("patch.explode");
  REQUIRE(response["ok"] == false);
  REQUIRE(response["id"] == 1);
  REQUIRE(errorCode(response) == "E_UNKNOWN_CMD");
  // Later phases own these; answering them today would be a lie.
  REQUIRE(errorCode(f.call("telemetry.subscribe")) == "E_UNKNOWN_CMD");
  REQUIRE(errorCode(f.call("midi.list")) == "E_UNKNOWN_CMD");
}

TEST_CASE("every command in the shared table has a handler", "[protocol]") {
  // The mirror of the exhaustiveness test in `shared/protocol/commands.test.ts`: a name in the table
  // with nothing behind it here is the failure this catches.
  Fixture f;
  FakeDeviceHost host;
  f.ctx.device = &host;
  for (const char* cmd : {"hello", "engine.ping", "engine.shutdown", "catalog.get", "patch.load",
                          "patch.clear", "patch.batch", "patch.setVoiceCount", "patch.setFeedbackMode",
                          "module.add", "module.remove", "edge.add", "edge.remove", "param.set",
                          "transport.play", "transport.stop", "transport.setTempo", "transport.setTimeSignature",
                          "transport.seek",
                          "device.list", "device.select"}) {
    const json response = f.call(cmd);
    if (response["ok"] == false) {
      INFO(cmd << " answered " << response["error"]["code"]);
      REQUIRE(response["error"]["code"] != "E_UNKNOWN_CMD");
    }
  }
}

TEST_CASE("a malformed request is answered rather than aborting the engine", "[protocol]") {
  Fixture f;
  // Not an object at all, no cmd, no id, and an args that is not an object.
  REQUIRE(errorCode(pg::dispatch(json::array({1, 2}), f.ctx)) == "E_SCHEMA");
  REQUIRE(errorCode(pg::dispatch(json{{"id", 1}}, f.ctx)) == "E_SCHEMA");
  REQUIRE(errorCode(pg::dispatch(json{{"cmd", "engine.ping"}}, f.ctx)) == "E_SCHEMA");
  REQUIRE(errorCode(pg::dispatch(json{{"id", 1}, {"cmd", "engine.ping"}, {"args", 7}}, f.ctx)) == "E_SCHEMA");
  // Wrong types where a string, a number and an object were expected.
  REQUIRE(errorCode(f.call("module.add", json{{"id", 7}, {"type", "test.gain"}})) == "E_SCHEMA");
  REQUIRE(errorCode(f.call("module.add", json{{"id", "a"}, {"type", "test.gain"}, {"params", 3}})) == "E_SCHEMA");
  REQUIRE(errorCode(f.call("module.add", json{{"id", "a"}, {"type", "test.gain"}, {"params", {{"gain", "loud"}}}})) == "E_SCHEMA");
  REQUIRE(errorCode(f.call("edge.add", json{{"id", "e"}, {"from", "src.out"}, {"to", "amp.in"}})) == "E_SCHEMA");
  REQUIRE(errorCode(f.call("param.set", json{{"module", "a"}, {"param", "gain"}, {"value", "loud"}})) == "E_SCHEMA");
  REQUIRE(f.nodeCount() == 0);
}

TEST_CASE("an unparseable line is answered with a null id", "[protocol]") {
  Fixture f;
  const std::string line = pg::dispatchLine("{not json", f.ctx);
  REQUIRE(line.back() == '\n');
  const json response = json::parse(line);
  REQUIRE(response["id"].is_null());
  REQUIRE(errorCode(response) == "E_SCHEMA");
  // A well-formed line still round-trips through the same entry point.
  const json pong = json::parse(pg::dispatchLine(R"({"id":"a","cmd":"engine.ping","args":{}})", f.ctx));
  REQUIRE(pong["id"] == "a");
  REQUIRE(pong["result"]["pong"] == true);
}

TEST_CASE("a graph edit commits and announces its revision", "[protocol]") {
  Fixture f;
  const json added = f.call("module.add", json{{"id", "solo"}, {"type", "test.const"}});
  REQUIRE(added["ok"] == true);
  REQUIRE(added["result"]["revision"] == f.revision());
  REQUIRE(f.emitted("patch.revision"));
  REQUIRE(f.ctx.events.front().data["revision"] == f.revision());

  const uint64_t before = f.revision();
  f.buildWorkingPatch();
  REQUIRE(f.revision() > before);
  REQUIRE(f.nodeCount() == 4);
  REQUIRE(f.edgeCount() == 2);
}

TEST_CASE("a rejected edit changes nothing and announces nothing", "[protocol]") {
  Fixture f;
  f.buildWorkingPatch();
  const uint64_t revision = f.revision();

  REQUIRE(errorCode(f.call("module.add", json{{"id", "src"}, {"type", "test.const"}})) == "E_DUP_ID");
  REQUIRE(errorCode(f.call("module.add", json{{"id", "nope"}, {"type", "test.nosuch"}})) == "E_UNKNOWN_TYPE");
  REQUIRE(errorCode(f.call("module.remove", json{{"id", "ghost"}})) == "E_NODE_NOT_FOUND");
  REQUIRE(errorCode(f.call("edge.remove", json{{"id", "ghost"}})) == "E_EDGE_NOT_FOUND");
  REQUIRE(errorCode(f.call("edge.add", json{{"id", "e9"},
                                            {"from", {{"module", "src"}, {"port", "nope"}}},
                                            {"to", {{"module", "amp"}, {"port", "in"}}}})) == "E_PORT_NOT_FOUND");
  REQUIRE_FALSE(f.emitted("patch.revision"));
  REQUIRE(f.revision() == revision);
  REQUIRE(f.nodeCount() == 3);
  REQUIRE(f.edgeCount() == 2);
}

TEST_CASE("patch.batch applies every op or none of them", "[protocol]") {
  Fixture f;
  f.buildWorkingPatch();
  const uint64_t revision = f.revision();

  // Trap 5. The bad op is in the MIDDLE: the ops before it would have applied one at a time, so a model
  // that is edited in place ends up half-changed and the client's document silently diverges.
  const json batch = json{{"ops", json::array({
      json{{"op", "moduleAdd"}, {"id", "lfo"}, {"type", "test.const"}},
      json{{"op", "moduleRemove"}, {"id", "ghost"}},
      json{{"op", "moduleAdd"}, {"id", "lfo2"}, {"type", "test.const"}},
  })}};
  REQUIRE(errorCode(f.call("patch.batch", batch)) == "E_NODE_NOT_FOUND");
  REQUIRE(f.nodeCount() == 3);
  REQUIRE_FALSE(f.engine.model().nodes().contains("lfo"));
  REQUIRE(f.revision() == revision);
  REQUIRE_FALSE(f.emitted("patch.revision"));

  // The same batch without the bad op commits once, not three times.
  const json good = json{{"ops", json::array({
      json{{"op", "moduleAdd"}, {"id", "lfo"}, {"type", "test.const"}},
      json{{"op", "moduleAdd"}, {"id", "lfo2"}, {"type", "test.const"}},
      json{{"op", "paramSet"}, {"module", "amp"}, {"param", "gain"}, {"value", 0.25}},
      json{{"op", "edgeAdd"}, {"id", "e3"},
           {"from", {{"module", "lfo"}, {"port", "out"}}}, {"to", {{"module", "amp"}, {"port", "param:gain"}}}},
      json{{"op", "edgeRemove"}, {"id", "e3"}},
      json{{"op", "moduleRemove"}, {"id", "lfo2"}},
      json{{"op", "setVoiceCount"}, {"voiceCount", 4}},
  })}};
  const json applied = f.call("patch.batch", good);
  REQUIRE(applied["ok"] == true);
  REQUIRE(applied["result"]["revision"] == revision + 1);   // one commit for the whole batch
  REQUIRE(f.nodeCount() == 4);
  REQUIRE(f.engine.model().voiceCount == 4);
  REQUIRE(f.engine.model().nodes().at("amp").params.at("gain") == Catch::Approx(0.25));
}

TEST_CASE("patch.batch rejects an op it does not know and keeps the model", "[protocol]") {
  Fixture f;
  f.buildWorkingPatch();
  const uint64_t revision = f.revision();
  REQUIRE(errorCode(f.call("patch.batch", json{{"ops", json::array({json{{"op", "moduleRename"}, {"id", "src"}}})}})) == "E_SCHEMA");
  REQUIRE(errorCode(f.call("patch.batch", json{{"ops", json::array({json{{"op", 7}}})}})) == "E_SCHEMA");
  REQUIRE(errorCode(f.call("patch.batch", json{{"ops", json::array({"moduleRemove"})}})) == "E_SCHEMA");
  REQUIRE(errorCode(f.call("patch.batch", json{{"ops", 3}})) == "E_SCHEMA");
  REQUIRE(f.revision() == revision);
  REQUIRE(f.nodeCount() == 3);
}

TEST_CASE("patch.batch tolerates the user-interface-only op the engine has no use for", "[protocol]") {
  Fixture f;
  f.buildWorkingPatch();
  // Engine sync drops `moduleMove` before sending; one that slips through must not fail the batch,
  // because where a node is drawn is not the engine's business either way.
  const json response = f.call("patch.batch", json{{"ops", json::array({
      json{{"op", "moduleMove"}, {"id", "src"}, {"x", 10}, {"y", 20}},
      json{{"op", "moduleAdd"}, {"id", "lfo"}, {"type", "test.const"}},
  })}});
  REQUIRE(response["ok"] == true);
  REQUIRE(f.nodeCount() == 4);
}

TEST_CASE("a commit failure is reported and the model goes back to what was playing", "[protocol]") {
  Fixture f;
  f.buildWorkingPatch();
  const uint64_t revision = f.revision();

  // `GraphModel` accepts 1..64 voices but the compiler tops out at 32, so this passes the model and
  // fails the commit -- the one path where the edit is valid and the program still cannot be built.
  const json refused = f.call("patch.setVoiceCount", json{{"voiceCount", 40}});
  REQUIRE(errorCode(refused) == "E_VOICES");
  REQUIRE(f.revision() == revision);
  REQUIRE(f.engine.model().voiceCount == 1);
  REQUIRE_FALSE(f.emitted("patch.revision"));

  // And the engine still works afterwards: the failure left nothing behind.
  REQUIRE(f.call("patch.setVoiceCount", json{{"voiceCount", 8}})["ok"] == true);
  REQUIRE(f.engine.model().voiceCount == 8);
}

TEST_CASE("patch.setVoiceCount and patch.setFeedbackMode validate their arguments", "[protocol]") {
  Fixture f;
  REQUIRE(errorCode(f.call("patch.setVoiceCount", json{{"voiceCount", 0}})) == "E_VOICES");
  REQUIRE(errorCode(f.call("patch.setVoiceCount", json{{"voiceCount", 65}})) == "E_VOICES");
  REQUIRE(errorCode(f.call("patch.setVoiceCount", json{{"voiceCount", 2.5}})) == "E_VOICES");
  REQUIRE(errorCode(f.call("patch.setVoiceCount", json::object())) == "E_SCHEMA");

  REQUIRE(f.call("patch.setFeedbackMode", json{{"mode", "block"}})["ok"] == true);
  REQUIRE(f.engine.model().feedbackMode == pg::FeedbackMode::Block);
  REQUIRE(errorCode(f.call("patch.setFeedbackMode", json{{"mode", "perSample"}})) == "E_SCHEMA");
  REQUIRE(f.engine.model().feedbackMode == pg::FeedbackMode::Block);
}

TEST_CASE("param.set writes the document and errors where there is nothing to write", "[protocol]") {
  Fixture f;
  f.buildWorkingPatch();
  const uint64_t revision = f.revision();

  const json set = f.call("param.set", json{{"module", "amp"}, {"param", "gain"}, {"value", 0.75}});
  REQUIRE(set["ok"] == true);
  REQUIRE(f.engine.model().nodes().at("amp").params.at("gain") == Catch::Approx(0.75));
  // A plain param reaches the audio thread through the queue: no recompile, so no new revision.
  REQUIRE(f.revision() == revision);
  REQUIRE_FALSE(f.emitted("patch.revision"));

  REQUIRE(errorCode(f.call("param.set", json{{"module", "ghost"}, {"param", "gain"}, {"value", 1}})) == "E_NODE_NOT_FOUND");
  REQUIRE(errorCode(f.call("param.set", json{{"module", "amp"}, {"param", "nope"}, {"value", 1}})) == "E_PARAM_NOT_FOUND");
  REQUIRE(errorCode(f.call("param.set", json{{"module", "amp"}, {"param", "gain"}})) == "E_SCHEMA");

  // `transient` is accepted and takes the same path; it only ever suppresses a rebuild.
  REQUIRE(f.call("param.set", json{{"module", "amp"}, {"param", "gain"}, {"value", 0.2}, {"transient", true}})["ok"] == true);
  REQUIRE(f.engine.model().nodes().at("amp").params.at("gain") == Catch::Approx(0.2));
}

TEST_CASE("patch.load replaces the whole document, or nothing at all", "[protocol]") {
  Fixture f;
  f.buildWorkingPatch();
  const uint64_t revision = f.revision();

  const json patch = json{
      {"schemaVersion", 1},
      {"voiceCount", 2},
      {"feedbackMode", "sample"},
      {"modules", json::array({json{{"id", "a"}, {"type", "test.const"}, {"params", {{"value", 0.25}}}},
                               json{{"id", "b"}, {"type", "test.sink"}}})},
      {"edges", json::array({json{{"id", "e"},
                                  {"from", {{"module", "a"}, {"port", "out"}}},
                                  {"to", {{"module", "b"}, {"port", "in"}}}}})}};
  REQUIRE(f.call("patch.load", json{{"patch", patch}})["ok"] == true);
  REQUIRE(f.nodeCount() == 2);
  REQUIRE(f.engine.model().voiceCount == 2);
  REQUIRE(f.revision() > revision);

  // A patch from another schema version leaves the loaded one alone.
  const uint64_t loaded = f.revision();
  json wrongVersion = patch;
  wrongVersion["schemaVersion"] = 2;
  REQUIRE(errorCode(f.call("patch.load", json{{"patch", wrongVersion}})) == "E_SCHEMA");
  REQUIRE(errorCode(f.call("patch.load", json::object())) == "E_SCHEMA");
  REQUIRE(f.nodeCount() == 2);
  REQUIRE(f.revision() == loaded);

  REQUIRE(f.call("patch.clear")["ok"] == true);
  REQUIRE(f.nodeCount() == 0);
  REQUIRE(f.edgeCount() == 0);
}

TEST_CASE("transport commands move the transport and report where it is", "[protocol]") {
  Fixture f;
  REQUIRE(f.call("transport.play")["result"]["playing"] == true);
  REQUIRE(f.call("transport.setTempo", json{{"tempo", 90}})["result"]["tempo"] == Catch::Approx(90.0));
  // A seek is answered truthfully before any audio thread has acknowledged it.
  REQUIRE(f.call("transport.seek", json{{"ppq", 8}})["result"]["ppq"] == Catch::Approx(8.0));
  const json stopped = f.call("transport.stop");
  REQUIRE(stopped["result"]["playing"] == false);
  REQUIRE(stopped["result"]["tempo"] == Catch::Approx(90.0));
  REQUIRE(stopped["result"]["samplePos"] == 0);

  REQUIRE(errorCode(f.call("transport.setTempo", json{{"tempo", 5000}})) == "E_SCHEMA");
  REQUIRE(errorCode(f.call("transport.setTempo", json{{"tempo", 0}})) == "E_SCHEMA");
  REQUIRE(errorCode(f.call("transport.seek", json{{"ppq", -1}})) == "E_SCHEMA");
  REQUIRE(errorCode(f.call("transport.seek", json::object())) == "E_SCHEMA");
  REQUIRE(f.call("transport.stop")["result"]["tempo"] == Catch::Approx(90.0));
}

TEST_CASE("the transport carries the project's meter, and modules read it", "[protocol]") {
  Fixture f;
  const json fourFour = f.call("transport.play")["result"];
  REQUIRE(fourFour["timeSigNumerator"] == 4);
  REQUIRE(fourFour["timeSigDenominator"] == 4);

  const json sixEight = f.call("transport.setTimeSignature", json{{"numerator", 6}, {"denominator", 8}});
  REQUIRE(sixEight["ok"] == true);
  REQUIRE(sixEight["result"]["timeSigNumerator"] == 6);
  REQUIRE(sixEight["result"]["timeSigDenominator"] == 8);

  // 6/8 is three quarter notes to the bar, so nine quarters in is bar 3, beat 0 (eighth notes).
  const json seeked = f.call("transport.seek", json{{"ppq", 9}});
  REQUIRE(seeked["result"]["bar"] == 3);
  REQUIRE(seeked["result"]["beat"] == Catch::Approx(0.0));
  REQUIRE(f.call("transport.seek", json{{"ppq", 10}})["result"]["beat"] == Catch::Approx(2.0));

  // A denominator is a note value, so it has to be a power of two, and the meter survives a refusal.
  REQUIRE(errorCode(f.call("transport.setTimeSignature", json{{"numerator", 4}, {"denominator", 3}})) == "E_SCHEMA");
  REQUIRE(errorCode(f.call("transport.setTimeSignature", json{{"numerator", 0}, {"denominator", 4}})) == "E_SCHEMA");
  REQUIRE(errorCode(f.call("transport.setTimeSignature", json{{"numerator", 4}})) == "E_SCHEMA");
  REQUIRE(f.call("transport.play")["result"]["timeSigDenominator"] == 8);

  // And the snapshot the audio thread hands every module carries it too.
  const pg::TransportSnapshot snapshot = f.transport.advance(64);
  REQUIRE(snapshot.timeSigNumerator == 6);
  REQUIRE(snapshot.timeSigDenominator == 8);
  REQUIRE(snapshot.quartersPerBar() == Catch::Approx(3.0));
  REQUIRE(snapshot.quartersPerBeat() == Catch::Approx(0.5));
  REQUIRE(pg::TransportSnapshot{}.quartersPerBar() == Catch::Approx(4.0));
}

TEST_CASE("device commands say so when this process has no device", "[protocol]") {
  Fixture f;
  REQUIRE(errorCode(f.call("device.list")) == "E_NOT_FOUND");
  REQUIRE(errorCode(f.call("device.select", json{{"id", "dev-a"}})) == "E_NOT_FOUND");

  FakeDeviceHost host;
  f.ctx.device = &host;
  const json list = f.call("device.list");
  REQUIRE(list["result"]["devices"].size() == 2);
  REQUIRE(list["result"]["devices"][0]["backend"] == "fake");
  REQUIRE(list["result"]["devices"][0]["isDefault"] == true);
  REQUIRE(list["result"]["current"] == "");
  REQUIRE_FALSE(f.emitted("device.changed"));

  REQUIRE(errorCode(f.call("device.select", json{{"id", "dev-z"}})) == "E_NOT_FOUND");
  REQUIRE_FALSE(f.emitted("device.changed"));

  const json selected = f.call("device.select", json{{"id", "dev-b"}});
  REQUIRE(selected["result"]["current"] == "dev-b");
  REQUIRE(f.emitted("device.changed"));
  REQUIRE(f.call("device.select", json{{"id", ""}})["result"]["current"] == "");
}

TEST_CASE("engine.shutdown answers before it asks to be closed", "[protocol]") {
  Fixture f;
  REQUIRE_FALSE(f.ctx.shutdownRequested);
  const json response = f.call("engine.shutdown");
  REQUIRE(response["ok"] == true);
  REQUIRE(f.ctx.shutdownRequested);
}

TEST_CASE("an event carries the connection's sequence number", "[protocol]") {
  const json e = pg::encodeEvent(pg::ProtocolEvent{"patch.revision", json{{"revision", 4}}}, 7);
  REQUIRE(e["event"] == "patch.revision");
  REQUIRE(e["seq"] == 7);
  REQUIRE(e["data"]["revision"] == 4);
}

TEST_CASE("the transport publishes a position the message thread can read", "[transport]") {
  pg::Transport t;
  t.prepare(48000.0);
  REQUIRE(t.state().samplePos == 0);
  REQUIRE(t.state().playing == false);

  // Stopped: engine time still runs, musical time does not. `NotesClip` and `PhaseClock` free-run on
  // `samplePos` precisely so a patch with no transport still has a clock.
  t.advance(64);
  t.advance(64);
  REQUIRE(t.state().samplePos == 128);
  REQUIRE(t.state().ppq == Catch::Approx(0.0));

  REQUIRE(t.setTempo(120.0).ok);
  t.play();
  const pg::TransportSnapshot block = t.advance(24000);   // half a second at 48 kHz
  REQUIRE(block.playing);
  REQUIRE(block.ppq == Catch::Approx(0.0));               // the snapshot is where the block STARTS
  REQUIRE(t.state().ppq == Catch::Approx(1.0));           // and 120 bpm covers one beat in half a second
  REQUIRE(t.state().samplePos == 128 + 24000);
}

TEST_CASE("a seek is reported before the audio thread applies it, and once after", "[transport]") {
  pg::Transport t;
  t.prepare(48000.0);
  t.play();
  t.advance(48000);
  REQUIRE(t.state().ppq > 0.0);

  REQUIRE(t.seek(16.0).ok);
  REQUIRE(t.state().ppq == Catch::Approx(16.0));   // no audio thread has run: the request is the answer
  const pg::TransportSnapshot applied = t.advance(64);
  REQUIRE(applied.ppq == Catch::Approx(16.0));     // the block starts where the seek asked
  REQUIRE(t.state().ppq > 16.0);                   // and the published position takes over again
  REQUIRE(t.state().samplePos == 48064);           // a seek moves musical time only
  REQUIRE_FALSE(t.seek(-1.0).ok);
}

TEST_CASE("the transport does not allocate on the render path", "[rt][transport]") {
  pg::Transport t;
  t.prepare(48000.0);
  t.play();
  pg::test::resetRtViolations();
  {
    pg::test::RtScope scope;
    for (int i = 0; i < 100; ++i) t.advance(64);
  }
  REQUIRE(pg::test::rtViolations() == 0);
}

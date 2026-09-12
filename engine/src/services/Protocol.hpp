#pragma once
#include <nlohmann/json.hpp>
#include <string>
#include <string_view>
#include <vector>
#include "core/Engine.hpp"
#include "core/Registry.hpp"
#include "core/Result.hpp"
#include "services/AudioDevice.hpp"
#include "services/PreviewPublisher.hpp"
#include "services/Telemetry.hpp"
#include "services/Transport.hpp"

namespace pg {

/// The protocol this build speaks. Mirrors `PROTOCOL_VERSION` in `shared/protocol/version.ts`; a client
/// asking for a different major is refused by `hello` rather than answered wrongly.
inline constexpr int kProtocolVersion = 1;

/// Something the engine says without being asked, queued by a handler and drained by whatever owns the
/// connection. Handlers cannot write to a socket -- they do not know there is one -- so this is how a
/// commit tells the world its revision moved.
struct ProtocolEvent {
  std::string name;
  nlohmann::json data;
};

/// What the protocol needs from whatever owns the audio device. `main.cpp` implements it over
/// `MiniaudioBackend`; a test implements it with three lines and no device at all. Null in the context
/// means this process has no device, and `device.*` says so rather than pretending.
class DeviceHost {
public:
  virtual ~DeviceHost() = default;
  virtual std::string backendName() const = 0;
  virtual std::vector<DeviceInfo> devices() = 0;
  /// The selected id; empty means the system default.
  virtual std::string currentId() const = 0;
  virtual double sampleRate() const = 0;
  virtual uint32_t channels() const = 0;
  virtual uint32_t periodFrames() const = 0;
  /// Reopens the device. Message thread: the audio thread is stopped for the duration.
  virtual Result select(const std::string& id) = 0;
};

/// Everything a handler is allowed to touch. Message thread only.
struct ProtocolContext {
  Engine& engine;
  Registry& registry;
  Transport& transport;
  DeviceHost* device = nullptr;
  /// The shared-memory segment, when this process opened one. Null means telemetry is off, and
  /// `hello` and `telemetry.*` say so rather than pretending.
  TelemetryWriter* telemetry = nullptr;
  /// Publishes watched modules' pictures, when there is a segment to publish into. Ticked by the
  /// command loop; handlers only hand out its slots.
  PreviewPublisher* previews = nullptr;
  /// Records the device's actual output on request; null in a process with no device callback.
  class Capture* capture = nullptr;
  /// Filled by handlers, drained by the caller after each dispatch.
  std::vector<ProtocolEvent> events;
  /// Set by `engine.shutdown`. The caller answers first, then closes.
  bool shutdownRequested = false;
};

/// One request in, one response out. No sockets, no threads, no globals: the socket loop is a thin shell
/// over this, which is why nearly every behaviour in the protocol is tested without one.
///
/// Never throws. A malformed argument comes back as `E_SCHEMA`, exactly as `loadPatchJson` already
/// behaves, because the alternative is an engine that a bad message can kill.
nlohmann::json dispatch(const nlohmann::json& request, ProtocolContext& ctx);

/// The same, framed: one line of JSON in, one line of JSON out, newline included. A line that is not
/// JSON is still answered -- with a null id, since there is none to echo -- because silence would leave
/// the client waiting on a promise that can never settle.
std::string dispatchLine(std::string_view line, ProtocolContext& ctx);

/// Where the transport is, as `transport.*` answers it and the `transport.position` event carries it.
/// `bar` and `beat` are derived from `ppq` and the meter rather than stored, so they cannot disagree.
nlohmann::json transportPositionJson(const Transport& transport);

/// `{event, seq, data}`, ready to write. `seq` is the connection's, not the protocol's.
nlohmann::json encodeEvent(const ProtocolEvent& event, uint64_t seq);

}  // namespace pg

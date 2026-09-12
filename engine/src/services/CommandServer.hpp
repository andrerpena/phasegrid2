#pragma once
#include <cstddef>
#include <string>
#include "core/Result.hpp"
#include "services/Protocol.hpp"

namespace pg {

/// Newline framing over a byte stream.
///
/// A socket read has nothing to do with message boundaries: it can split one message anywhere, including
/// mid-token, and it can hand over three at once. So everything after the last newline is kept until the
/// next chunk completes it (trap 2). A message never contains a raw newline, because the JSON writer
/// escapes them, which is what makes the delimiter unambiguous.
class LineBuffer {
public:
  void append(const char* data, size_t length) { carry_.append(data, length); }
  /// Moves the next complete line out and drops it. False when nothing is complete yet.
  bool next(std::string& line);
  /// What has arrived since the last newline. Non-empty at end of stream means a truncated message.
  const std::string& pending() const { return carry_; }
  void clear() { carry_.clear(); }

private:
  std::string carry_;
};

/// A Unix domain socket, one client, and the message loop that drives `dispatch`.
///
/// Single client on purpose: this is one interface driving one engine, and a second connection would be a
/// second opinion about what the patch is. Everything here runs on the message thread; the audio thread
/// never sees the socket and never waits for it.
class CommandServer {
public:
  explicit CommandServer(ProtocolContext& ctx) : ctx_(ctx) {}
  ~CommandServer();
  CommandServer(const CommandServer&) = delete;
  CommandServer& operator=(const CommandServer&) = delete;

  /// Binds and listens. Unlinks a stale socket file first, and refuses a path too long for `sun_path`
  /// rather than binding to a silently truncated one (trap 1).
  Result listen(const std::string& path);
  /// Waits for the client. A negative timeout waits forever; `E_IO` when nobody arrives, so an engine
  /// whose supervisor died at birth exits instead of holding the audio device for good.
  Result acceptClient(int timeoutMs = -1);

  /// One turn of the loop: wait up to `timeoutMs`, read whatever is there, answer every complete message.
  /// False means stop -- the client is gone (end of stream, trap 3) or asked for a shutdown.
  bool step(int timeoutMs);
  /// Turns until one of them says stop, publishing `transport.position` at about 20 Hz on the way.
  void run(int timeoutMs = 20);

  /// Queues an event for the client; `flushEvents` writes it. Events and responses share one queue and
  /// one order, so a `patch.revision` always follows the response that caused it.
  void push(std::string name, nlohmann::json data);
  /// False means the client is gone.
  bool flushEvents();
  /// Publishes `transport.position` if the transport has moved since the last one. False = client gone.
  bool tickTransport();

  bool connected() const { return clientFd_ >= 0; }
  uint64_t eventsSent() const { return seq_; }
  const std::string& path() const { return path_; }
  /// The framing buffer, so a test can see what is still incomplete.
  const LineBuffer& buffer() const { return buffer_; }

private:
  bool writeRaw(const std::string& bytes);
  void closeClient();

  ProtocolContext& ctx_;
  int listenFd_ = -1;
  int clientFd_ = -1;
  std::string path_;
  LineBuffer buffer_;
  uint64_t seq_ = 0;
  TransportSnapshot lastPublished_{};
  bool publishedOnce_ = false;
};

}  // namespace pg

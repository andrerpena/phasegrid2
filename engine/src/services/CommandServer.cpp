#include "services/CommandServer.hpp"
#include <poll.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>
#include <cerrno>
#include <chrono>
#include <cstring>
#include <utility>

namespace pg {
namespace {

/// Blocking sends are fine while the client is reading, and a client that has stopped reading is a client
/// that is gone. Without this the engine would block forever holding the audio device.
constexpr int kSendTimeoutSeconds = 5;

Result ioError(const std::string& what) {
  return Result::fail("E_IO", what + ": " + std::strerror(errno));
}

}  // namespace

bool LineBuffer::next(std::string& line) {
  const size_t newline = carry_.find('\n');
  if (newline == std::string::npos) return false;
  line.assign(carry_, 0, newline);
  carry_.erase(0, newline + 1);
  // Tolerate a client that writes CRLF, and skip a blank line rather than answering it with a parse error.
  if (!line.empty() && line.back() == '\r') line.pop_back();
  if (line.empty()) return next(line);
  return true;
}

CommandServer::~CommandServer() {
  closeClient();
  if (listenFd_ >= 0) ::close(listenFd_);
  if (!path_.empty()) ::unlink(path_.c_str());
}

Result CommandServer::listen(const std::string& path) {
  sockaddr_un address{};
  address.sun_family = AF_UNIX;
  // macOS caps `sun_path` at 104 bytes and `bind` truncates silently, which binds a socket at a path
  // nobody will connect to. Measured, not hoped for (trap 1).
  if (path.empty() || path.size() >= sizeof(address.sun_path))
    return Result::fail("E_IO", "socket path is " + std::to_string(path.size()) + " bytes; the limit is " +
                                   std::to_string(sizeof(address.sun_path) - 1));

  ::unlink(path.c_str());   // a stale file from a crashed engine would fail the bind
  const int fd = ::socket(AF_UNIX, SOCK_STREAM, 0);
  if (fd < 0) return ioError("socket");
  std::memcpy(address.sun_path, path.c_str(), path.size());
  if (::bind(fd, reinterpret_cast<const sockaddr*>(&address), sizeof(address)) != 0) {
    const Result failure = ioError("bind " + path);
    ::close(fd);
    return failure;
  }
  if (::listen(fd, 1) != 0) {
    const Result failure = ioError("listen " + path);
    ::close(fd);
    ::unlink(path.c_str());
    return failure;
  }
  listenFd_ = fd;
  path_ = path;
  return {};
}

Result CommandServer::acceptClient(int timeoutMs) {
  if (listenFd_ < 0) return Result::fail("E_IO", "not listening");
  pollfd waiting{listenFd_, POLLIN, 0};
  for (;;) {
    const int ready = ::poll(&waiting, 1, timeoutMs);
    if (ready < 0) {
      if (errno == EINTR) continue;
      return ioError("poll");
    }
    if (ready == 0) return Result::fail("E_IO", "no client connected");
    break;
  }
  const int fd = ::accept(listenFd_, nullptr, nullptr);
  if (fd < 0) return ioError("accept");
#ifdef SO_NOSIGPIPE
  // Without this a write to a client that has gone away kills the process with SIGPIPE instead of
  // returning EPIPE, and the engine dies holding the audio device rather than shutting down cleanly.
  const int on = 1;
  ::setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &on, sizeof(on));
#endif
  timeval sendTimeout{kSendTimeoutSeconds, 0};
  ::setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &sendTimeout, sizeof(sendTimeout));
  clientFd_ = fd;
  buffer_.clear();
  return {};
}

void CommandServer::closeClient() {
  if (clientFd_ >= 0) ::close(clientFd_);
  clientFd_ = -1;
}

bool CommandServer::writeRaw(const std::string& bytes) {
  size_t written = 0;
  while (written < bytes.size()) {
    const ssize_t n = ::send(clientFd_, bytes.data() + written, bytes.size() - written, 0);
    if (n > 0) {
      written += static_cast<size_t>(n);
      continue;
    }
    if (n < 0 && errno == EINTR) continue;
    return false;   // EPIPE, or a client that stopped reading for five seconds: either way it is gone
  }
  return true;
}

void CommandServer::push(std::string name, nlohmann::json data) {
  ctx_.events.push_back(ProtocolEvent{std::move(name), std::move(data)});
}

bool CommandServer::flushEvents() {
  bool alive = true;
  for (const ProtocolEvent& event : ctx_.events) {
    if (!alive) break;
    alive = writeRaw(encodeEvent(event, ++seq_).dump() + "\n");
  }
  ctx_.events.clear();
  return alive;
}

bool CommandServer::step(int timeoutMs) {
  if (clientFd_ < 0 || ctx_.shutdownRequested) return false;

  pollfd waiting{clientFd_, POLLIN, 0};
  const int ready = ::poll(&waiting, 1, timeoutMs);
  if (ready < 0) return errno == EINTR;      // a signal is not a reason to stop
  if (ready == 0) return true;               // idle: the caller gets its turn to publish

  char chunk[4096];
  const ssize_t got = ::recv(clientFd_, chunk, sizeof(chunk), 0);
  // End of stream is the shutdown signal (trap 3). An engine that outlived its client would keep the
  // audio device open forever, and every crash-restart cycle would leave another one behind.
  if (got == 0) return false;
  if (got < 0) return errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR;
  buffer_.append(chunk, static_cast<size_t>(got));

  std::string line;
  while (buffer_.next(line)) {
    if (!writeRaw(dispatchLine(line, ctx_))) return false;
    if (!flushEvents()) return false;
    // Answered first, then closed: a deliberate shutdown must be distinguishable from a crash.
    if (ctx_.shutdownRequested) return false;
  }
  return true;
}

bool CommandServer::tickTransport() {
  const TransportSnapshot now = ctx_.transport.state();
  const bool moved = !publishedOnce_ || now.samplePos != lastPublished_.samplePos || now.ppq != lastPublished_.ppq ||
                     now.playing != lastPublished_.playing || now.tempo != lastPublished_.tempo ||
                     now.timeSigNumerator != lastPublished_.timeSigNumerator ||
                     now.timeSigDenominator != lastPublished_.timeSigDenominator;
  if (!moved) return true;   // a stopped engine says nothing rather than filling the log with itself
  lastPublished_ = now;
  publishedOnce_ = true;
  push("transport.position", transportPositionJson(ctx_.transport));
  return flushEvents();
}

void CommandServer::run(int timeoutMs) {
  using clock = std::chrono::steady_clock;
  auto nextPosition = clock::now();
  auto nextPreview = clock::now();
  while (step(timeoutMs)) {
    const auto now = clock::now();
    if (now >= nextPosition) {
      nextPosition = now + std::chrono::milliseconds(50);   // about twenty times a second
      if (!tickTransport()) break;
    }
    // The faces: every watched module's picture, redrawn when its values moved. Faster than the
    // transport because a face is watched the way a knob is, and slower than the display's frame
    // rate because a picture that changes thirty times a second is already continuous to the eye.
    if (ctx_.previews != nullptr && now >= nextPreview) {
      nextPreview = now + std::chrono::milliseconds(33);
      ctx_.previews->tick();
    }
    // The message thread's other job: free the programs the audio thread retired. `commit` does this too,
    // but a session that stops editing would otherwise hold the last retired program forever.
    ctx_.engine.collectGarbage();
  }
}

}  // namespace pg

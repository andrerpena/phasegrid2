#include <catch2/catch_test_macros.hpp>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>
#include <cstring>
#include <string>
#include "modules/TestModules.hpp"
#include "services/CommandServer.hpp"

using nlohmann::json;

namespace {

/// A socket path short enough for `sun_path` and unique to this process, so two test runs never collide.
std::string socketPath(const char* name) {
  return "/tmp/pg-" + std::string(name) + "-" + std::to_string(::getpid()) + ".sock";
}

/// The other end of the socket. Every wait has a hard timeout: a server that misbehaves must fail the
/// test, never hang the suite, and there are no sleeps anywhere -- the client and the server take turns
/// on this one thread.
class TestClient {
public:
  explicit TestClient(const std::string& path) {
    fd_ = ::socket(AF_UNIX, SOCK_STREAM, 0);
    REQUIRE(fd_ >= 0);
    sockaddr_un address{};
    address.sun_family = AF_UNIX;
    REQUIRE(path.size() < sizeof(address.sun_path));
    std::memcpy(address.sun_path, path.c_str(), path.size());
    REQUIRE(::connect(fd_, reinterpret_cast<const sockaddr*>(&address), sizeof(address)) == 0);
    timeval timeout{2, 0};
    ::setsockopt(fd_, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
    ::setsockopt(fd_, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
  }
  ~TestClient() { disconnect(); }
  TestClient(const TestClient&) = delete;
  TestClient& operator=(const TestClient&) = delete;

  void write(const std::string& bytes) {
    REQUIRE(::send(fd_, bytes.data(), bytes.size(), 0) == static_cast<ssize_t>(bytes.size()));
  }
  void disconnect() {
    if (fd_ >= 0) ::close(fd_);
    fd_ = -1;
  }

  /// One message. Fails the test if none arrives before the receive timeout expires.
  json readMessage() {
    std::string line;
    while (!buffer_.next(line)) {
      char chunk[1024];
      const ssize_t got = ::recv(fd_, chunk, sizeof(chunk), 0);
      if (got <= 0) FAIL("no message from the server within the timeout");
      buffer_.append(chunk, static_cast<size_t>(got));
    }
    return json::parse(line);
  }

private:
  int fd_ = -1;
  pg::LineBuffer buffer_;
};

/// A server on a real socket with a real engine behind it, torn down with the test.
struct ServerFixture {
  pg::Registry registry;
  pg::Engine engine{registry, pg::EngineConfig{48000.0, 64}};
  pg::Transport transport;
  pg::ProtocolContext ctx{.engine = engine, .registry = registry, .transport = transport};
  pg::CommandServer server{ctx};
  std::string path;

  explicit ServerFixture(const char* name) : path(socketPath(name)) {
    pg::test::registerTestModules(registry);
    const pg::Result listening = server.listen(path);
    INFO(listening.code << ": " << listening.message);
    REQUIRE(listening.ok);
  }
};

std::string request(int id, const std::string& cmd, json args = json::object()) {
  return json{{"id", id}, {"cmd", cmd}, {"args", std::move(args)}}.dump() + "\n";
}

}  // namespace

TEST_CASE("the framing buffer keeps what is not a whole line yet", "[server]") {
  pg::LineBuffer buffer;
  std::string line;

  // Trap 2, at the unit level: a read can end anywhere, including inside a token.
  buffer.append("{\"id\":1,\"cmd\":\"engi", 19);
  REQUIRE_FALSE(buffer.next(line));
  REQUIRE(buffer.pending() == "{\"id\":1,\"cmd\":\"engi");
  const std::string rest = "ne.ping\",\"args\":{}}\n";
  buffer.append(rest.data(), rest.size());
  REQUIRE(buffer.next(line));
  REQUIRE(json::parse(line)["cmd"] == "engine.ping");
  REQUIRE_FALSE(buffer.next(line));

  // And three at once come out as three, in order.
  const std::string three = "{\"a\":1}\n{\"a\":2}\n{\"a\":3}\n";
  buffer.append(three.data(), three.size());
  for (int expected = 1; expected <= 3; ++expected) {
    REQUIRE(buffer.next(line));
    REQUIRE(json::parse(line)["a"] == expected);
  }
  REQUIRE_FALSE(buffer.next(line));

  // Blank lines and a CRLF client are tolerated rather than answered with a parse error.
  const std::string blanks = "\n\r\n{\"a\":4}\r\n";
  buffer.append(blanks.data(), blanks.size());
  REQUIRE(buffer.next(line));
  REQUIRE(json::parse(line)["a"] == 4);
  REQUIRE_FALSE(buffer.next(line));
}

TEST_CASE("a socket path longer than the platform allows is refused, not truncated", "[server]") {
  // Trap 1 on the engine side: `bind` truncates silently, which would leave a socket at a path nobody
  // can connect to. macOS caps `sun_path` at 104 bytes, and Electron's userData directory is close.
  pg::Registry registry;
  pg::Engine engine{registry, pg::EngineConfig{48000.0, 64}};
  pg::Transport transport;
  pg::ProtocolContext ctx{.engine = engine, .registry = registry, .transport = transport};
  pg::CommandServer server{ctx};

  const pg::Result refused = server.listen("/tmp/" + std::string(200, 'x') + ".sock");
  REQUIRE_FALSE(refused.ok);
  REQUIRE(refused.code == "E_IO");
  REQUIRE(refused.message.find("limit") != std::string::npos);
  REQUIRE(server.listen("").ok == false);
}

TEST_CASE("a request and its answer cross a real socket", "[server]") {
  ServerFixture f("hello");
  TestClient client(f.path);
  REQUIRE(f.server.acceptClient(2000).ok);

  client.write(request(1, "hello", json{{"protocolVersion", pg::kProtocolVersion}}));
  REQUIRE(f.server.step(2000));
  const json response = client.readMessage();
  REQUIRE(response["id"] == 1);
  REQUIRE(response["ok"] == true);
  REQUIRE(response["result"]["protocolVersion"] == pg::kProtocolVersion);
}

TEST_CASE("a request split across two writes still gets exactly one answer", "[server]") {
  ServerFixture f("split");
  TestClient client(f.path);
  REQUIRE(f.server.acceptClient(2000).ok);

  // Trap 2 over a real socket, which is the only place the bug appears: split mid-token, so a reader
  // without a carry buffer parses neither half.
  const std::string line = request(7, "engine.ping");
  const size_t cut = line.find("engine") + 3;
  client.write(line.substr(0, cut));
  REQUIRE(f.server.step(2000));                 // half a message: read, kept, nothing answered
  REQUIRE_FALSE(f.server.buffer().pending().empty());
  client.write(line.substr(cut));
  REQUIRE(f.server.step(2000));
  REQUIRE(f.server.buffer().pending().empty());

  const json response = client.readMessage();
  REQUIRE(response["id"] == 7);
  REQUIRE(response["result"]["pong"] == true);
}

TEST_CASE("two requests in one write both get answers, in order", "[server]") {
  ServerFixture f("batched");
  TestClient client(f.path);
  REQUIRE(f.server.acceptClient(2000).ok);

  client.write(request(1, "engine.ping") + request(2, "catalog.get"));
  REQUIRE(f.server.step(2000));
  REQUIRE(client.readMessage()["id"] == 1);
  const json catalog = client.readMessage();
  REQUIRE(catalog["id"] == 2);
  REQUIRE(catalog["result"]["modules"].size() == f.registry.all().size());
}

TEST_CASE("an edit is answered first and announced second", "[server]") {
  ServerFixture f("events");
  TestClient client(f.path);
  REQUIRE(f.server.acceptClient(2000).ok);

  client.write(request(1, "module.add", json{{"id", "src"}, {"type", "test.const"}}));
  REQUIRE(f.server.step(2000));

  const json response = client.readMessage();
  REQUIRE(response["ok"] == true);
  const json event = client.readMessage();
  REQUIRE(event["event"] == "patch.revision");
  REQUIRE(event["seq"] == 1);   // per connection, from one
  REQUIRE(event["data"]["revision"] == response["result"]["revision"]);

  // A refused edit says nothing beyond its own error.
  client.write(request(2, "module.add", json{{"id", "src"}, {"type", "test.const"}}));
  REQUIRE(f.server.step(2000));
  REQUIRE(client.readMessage()["error"]["code"] == "E_DUP_ID");
  client.write(request(3, "engine.ping"));
  REQUIRE(f.server.step(2000));
  REQUIRE(client.readMessage()["id"] == 3);   // the next message is the next answer, not a stray event
}

TEST_CASE("the engine stops when its client goes away", "[server]") {
  ServerFixture f("eof");
  TestClient client(f.path);
  REQUIRE(f.server.acceptClient(2000).ok);
  client.write(request(1, "engine.ping"));
  REQUIRE(f.server.step(2000));
  REQUIRE(client.readMessage()["id"] == 1);

  // Trap 3. End of stream is a shutdown: an engine that outlives its client keeps the audio device, and
  // every crash-restart cycle would leave another orphan holding it.
  client.disconnect();
  REQUIRE_FALSE(f.server.step(2000));
  // And the loop agrees: `run` returns rather than spinning.
  f.server.run(20);
}

TEST_CASE("engine.shutdown is answered before the loop ends", "[server]") {
  ServerFixture f("shutdown");
  TestClient client(f.path);
  REQUIRE(f.server.acceptClient(2000).ok);

  client.write(request(1, "engine.shutdown"));
  REQUIRE_FALSE(f.server.step(2000));   // the loop ends...
  REQUIRE(client.readMessage()["ok"] == true);   // ...but not before the client was told
  REQUIRE(f.ctx.shutdownRequested);
}

TEST_CASE("transport.position is published only when the transport has moved", "[server]") {
  ServerFixture f("position");
  TestClient client(f.path);
  REQUIRE(f.server.acceptClient(2000).ok);

  REQUIRE(f.server.tickTransport());              // the first tick states where things are
  const json first = client.readMessage();
  REQUIRE(first["event"] == "transport.position");
  REQUIRE(first["data"]["playing"] == false);

  REQUIRE(f.server.tickTransport());              // nothing moved: nothing said
  const uint64_t sent = f.server.eventsSent();
  REQUIRE(f.server.tickTransport());
  REQUIRE(f.server.eventsSent() == sent);

  f.transport.play();
  f.transport.advance(4800);                      // as the audio callback would
  REQUIRE(f.server.tickTransport());
  const json moved = client.readMessage();
  REQUIRE(moved["data"]["playing"] == true);
  REQUIRE(moved["data"]["samplePos"] == 4800);
  REQUIRE(moved["seq"] == 2);
}

TEST_CASE("a malformed line over the socket is answered rather than dropped", "[server]") {
  ServerFixture f("malformed");
  TestClient client(f.path);
  REQUIRE(f.server.acceptClient(2000).ok);

  client.write("{not json at all\n");
  REQUIRE(f.server.step(2000));
  const json response = client.readMessage();
  REQUIRE(response["id"].is_null());
  REQUIRE(response["error"]["code"] == "E_SCHEMA");

  // The connection survives it: one bad line does not poison the stream.
  client.write(request(2, "engine.ping"));
  REQUIRE(f.server.step(2000));
  REQUIRE(client.readMessage()["id"] == 2);
}

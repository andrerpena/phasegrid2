#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <optional>
#include <string>
#include <thread>
#include <vector>
#include "app/Tone.hpp"
#include "core/Engine.hpp"
#include "core/Version.hpp"
#include "modules/builtin.hpp"
#include "render/OfflineRenderer.hpp"
#include "render/PatchFile.hpp"
#include "services/BlockSplitter.hpp"
#include "services/Catalog.hpp"
#include "services/CommandServer.hpp"
#include "services/MiniaudioBackend.hpp"
#include "services/Protocol.hpp"
#include "services/PreviewPublisher.hpp"
#include "services/Telemetry.hpp"
#include "services/Transport.hpp"

static int usage() {
  std::puts(
      "phasegrid-engine\n"
      "  --version\n"
      "  --tone [seconds]      play a 440 Hz test tone on the default device\n"
      "  --render <patch.json> --out <file.wav> [--seconds N] [--sr N] [--block N]\n"
      "  --catalog             print the module catalog as JSON\n"
      "  --socket <path> [--shm <name>] [--device <id|null>]\n"
      "                        open the audio device and take commands on a Unix socket;\n"
      "                        `--device null` runs silently with no hardware");
  return 2;
}

static int runTone(int seconds) {
  pg::MiniaudioBackend backend;
  for (const auto& d : backend.enumerate())
    std::printf("device %s: %s%s\n", d.id.c_str(), d.name.c_str(), d.isDefault ? " (default)" : "");
  pg::ToneGenerator tone;
  pg::BlockSplitter splitter;
  splitter.prepare(64, 2);
  pg::DeviceConfig cfg;

  // Prepared before open() so the audio thread never observes a mid-update tone state.
  tone.prepare(cfg.sampleRate, 440.0);
  const uint32_t channels = cfg.channels;
  // Built once (not per-callback) to keep the RT path free of std::function construction.
  pg::BlockSplitter::BlockFn block = [&tone, channels](float* b, uint32_t n) { tone.render(b, n, channels); };
  auto render = [&](float* out, uint32_t frames, uint32_t) { splitter.render(out, frames, block); };

  std::string err;
  bool ok = backend.open(cfg, render, err);
  if (!ok) { std::fprintf(stderr, "open failed: %s\n", err.c_str()); return 1; }
  if (backend.sampleRate() != cfg.sampleRate) {
    // The device negotiated a different rate; the audio thread is stopped between
    // close() and open(), so re-preparing tone here is race-free.
    backend.close();
    tone.prepare(backend.sampleRate(), 440.0);
    ok = backend.open(cfg, render, err);
    if (!ok) { std::fprintf(stderr, "open failed: %s\n", err.c_str()); return 1; }
  }
  std::printf("playing %d s at %.0f Hz, %u ch\n", seconds, backend.sampleRate(), backend.channels());
  std::this_thread::sleep_for(std::chrono::seconds(seconds));
  backend.close();
  return 0;
}

static int runRender(int argc, char** argv) {
  std::string patch, out; double seconds = 2.0, sr = 48000.0; uint32_t block = 64;
  bool badArgs = false;
  for (int i = 2; i < argc; ++i) {
    const std::string a = argv[i];
    // A value must exist and must not itself be a flag: `--seconds --out x.wav` used to swallow
    // "--out" and silently render 0 seconds.
    auto hasValue = [&] { return i + 1 < argc && std::strncmp(argv[i + 1], "--", 2) != 0; };
    auto next = [&](double& v) { if (hasValue()) v = std::atof(argv[++i]); else badArgs = true; };
    if (a == "--seconds") next(seconds);
    else if (a == "--sr") next(sr);
    else if (a == "--block") { double b = 64; next(b); block = static_cast<uint32_t>(b); }
    else if (a == "--out") { if (hasValue()) out = argv[++i]; else badArgs = true; }
    else if (patch.empty()) patch = a;
  }
  if (badArgs || patch.empty() || out.empty()) { std::fprintf(stderr, "usage: --render <patch.json> --out <file.wav> [--seconds N] [--sr N] [--block N]\n"); return 2; }
  pg::Registry reg;
  pg::registerBuiltinModules(reg);
  pg::Engine engine{reg, pg::EngineConfig{sr, block}};
  if (pg::Result r = pg::loadPatchFile(patch, reg, engine.model()); !r) { std::fprintf(stderr, "%s: %s\n", r.code.c_str(), r.message.c_str()); return 1; }
  if (pg::Result r = engine.commit(); !r) { std::fprintf(stderr, "%s: %s\n", r.code.c_str(), r.message.c_str()); return 1; }
  const std::vector<float> data = pg::renderInterleaved(engine, pg::RenderOptions{seconds, 2});
  std::string err;
  if (!pg::writeWav(out, data, 2, sr, err)) { std::fprintf(stderr, "%s\n", err.c_str()); return 1; }
  std::printf("rendered %zu frames to %s\n", data.size() / 2, out.c_str());
  return 0;
}

/// Every built-in module's ports, params and ranges, as JSON on stdout. The user interface reads this
/// instead of carrying a hand-written copy of the module list, which is why adding a module needs no
/// TypeScript change.
static int runCatalog() {
  pg::Registry reg;
  pg::registerBuiltinModules(reg);
  std::printf("%s\n", pg::catalogJson(reg).dump(2).c_str());
  return 0;
}

/// The audio device, as `device.list` and `device.select` see it. Reopening is a message-thread
/// operation: the device thread is stopped between `close` and `open`, so the render callback is not
/// running while the configuration changes underneath it.
class BackendDeviceHost final : public pg::DeviceHost {
public:
  BackendDeviceHost(pg::MiniaudioBackend& backend, pg::DeviceConfig config, pg::RenderFn render, pg::Transport& transport)
      : backend_(backend), config_(std::move(config)), render_(std::move(render)), transport_(transport) {}

  std::string backendName() const override { return backend_.name(); }
  std::vector<pg::DeviceInfo> devices() override { return backend_.enumerate(); }
  std::string currentId() const override { return config_.deviceId; }
  double sampleRate() const override { return backend_.sampleRate(); }
  uint32_t channels() const override { return backend_.channels(); }

  pg::Result select(const std::string& id) override {
    if (id == config_.deviceId) return {};
    const double previousRate = backend_.sampleRate();
    pg::DeviceConfig wanted = config_;
    wanted.deviceId = id;

    backend_.close();
    std::string error;
    if (!backend_.open(wanted, render_, error)) return restore("cannot open device '" + id + "': " + error);
    // The engine was built for one sample rate and its modules were prepared at it. Rebuilding the whole
    // engine for a new rate is not this phase's job, so a device that will not run at the current rate is
    // refused rather than played at the wrong speed.
    if (backend_.sampleRate() != previousRate) {
      backend_.close();
      return restore("device '" + id + "' runs at " + std::to_string(static_cast<int>(backend_.sampleRate())) +
                     " Hz; this engine is running at " + std::to_string(static_cast<int>(previousRate)) + " Hz");
    }
    config_ = wanted;
    transport_.prepare(backend_.sampleRate());
    return {};
  }

private:
  /// Puts the previous device back, so a refused choice leaves the engine playing rather than silent.
  pg::Result restore(std::string why) {
    std::string error;
    if (!backend_.open(config_, render_, error)) return pg::Result::fail("E_IO", why + " (and the previous device did not reopen: " + error + ")");
    transport_.prepare(backend_.sampleRate());
    return pg::Result::fail("E_NOT_FOUND", std::move(why));
  }

  pg::MiniaudioBackend& backend_;
  pg::DeviceConfig config_;
  pg::RenderFn render_;
  pg::Transport& transport_;
};

/// What `--device` asked for: a device id for the native backend, or the null backend.
struct DeviceChoice {
  std::string id;
  pg::AudioBackendKind kind = pg::AudioBackendKind::Native;
};

/// Opens the audio device, then takes commands on a Unix socket until the client goes away.
static int runSocket(const std::string& path, const std::string& shmName, const DeviceChoice& choice) {
  pg::Registry registry;
  pg::registerBuiltinModules(registry);
  pg::Transport transport;

  // The engine cannot be built before the device is open, because it has to be built at the rate the
  // device negotiated; the callback cannot be written after the device is open, because `open` takes it.
  // So the callback reads the engine through a pointer that is null for the first few milliseconds.
  std::atomic<pg::Engine*> live{nullptr};
  pg::MiniaudioBackend backend{choice.kind};
  pg::RenderFn render = [&live, &transport](float* out, uint32_t frames, uint32_t channels) {
    const pg::TransportSnapshot moment = transport.advance(frames);
    pg::Engine* engine = live.load(std::memory_order_acquire);
    if (engine == nullptr) {
      std::memset(out, 0, static_cast<size_t>(frames) * channels * sizeof(float));
      return;
    }
    engine->renderInterleaved(out, frames, channels, moment);
  };

  pg::DeviceConfig config;
  config.deviceId = choice.id;
  std::string error;
  if (!backend.open(config, render, error)) {
    std::fprintf(stderr, "open failed: %s\n", error.c_str());
    return 1;
  }
  transport.prepare(backend.sampleRate());
  pg::Engine engine{registry, pg::EngineConfig{backend.sampleRate(), pg::kDefaultBlockSize}};
  live.store(&engine, std::memory_order_release);

  // Telemetry is optional. A segment that cannot be created leaves the engine fully working with no
  // meters, which is a far better outcome than refusing to make sound because a display failed.
  pg::TelemetryWriter telemetry;
  if (!shmName.empty()) {
    std::string shmError;
    if (telemetry.create(shmName, pg::kTelemetryMaxSlots, backend.sampleRate(), pg::kDefaultBlockSize,
                         shmError))
      engine.setTelemetry(&telemetry);
    else
      std::fprintf(stderr, "telemetry disabled: %s\n", shmError.c_str());
  }

  BackendDeviceHost host{backend, config, render, transport};
  // The faces' pictures, published into the same segment; nothing to publish into without one.
  std::optional<pg::PreviewPublisher> previews;
  if (telemetry.valid()) previews.emplace(engine, telemetry);
  pg::ProtocolContext ctx{.engine = engine,
                          .registry = registry,
                          .transport = transport,
                          .device = &host,
                          .telemetry = telemetry.valid() ? &telemetry : nullptr,
                          .previews = previews ? &*previews : nullptr};
  pg::CommandServer server{ctx};
  if (pg::Result r = server.listen(path); !r) {
    std::fprintf(stderr, "%s: %s\n", r.code.c_str(), r.message.c_str());
    backend.close();
    return 1;
  }
  // Accept before announcing anything: an engine nobody connects to would sit on the audio device
  // forever, which is exactly the orphan the supervisor's restart loop must never leave behind.
  if (pg::Result r = server.acceptClient(30000); !r) {
    std::fprintf(stderr, "%s: %s\n", r.code.c_str(), r.message.c_str());
    backend.close();
    return 1;
  }

  server.push("engine.ready", nlohmann::json{{"engineVersion", pg::engineVersion()},
                                             {"sampleRate", backend.sampleRate()},
                                             {"channels", backend.channels()},
                                             {"blockSize", engine.config().blockSize}});
  server.flushEvents();
  server.run();

  // The client is gone, or asked to stop. Either way this process is finished: the device closes here
  // rather than at exit, so nothing is still pulling audio while the graph is torn down.
  live.store(nullptr, std::memory_order_release);
  backend.close();
  return 0;
}

int main(int argc, char** argv) {
  if (argc >= 2 && std::strcmp(argv[1], "--version") == 0) { std::printf("%s\n", pg::engineVersion()); return 0; }
  if (argc >= 2 && std::strcmp(argv[1], "--tone") == 0) return runTone(argc >= 3 ? std::atoi(argv[2]) : 3);
  if (argc >= 2 && std::strcmp(argv[1], "--render") == 0) return runRender(argc, argv);
  if (argc >= 2 && std::strcmp(argv[1], "--catalog") == 0) return runCatalog();
  if (argc >= 2 && std::strcmp(argv[1], "--socket") == 0) {
    if (argc < 3) { std::fprintf(stderr, "usage: --socket <path> [--shm <name>] [--device <id|null>]\n"); return 2; }
    std::string shmName;
    DeviceChoice choice;
    for (int i = 3; i + 1 < argc; ++i) {
      if (std::strcmp(argv[i], "--shm") == 0) shmName = argv[i + 1];
      if (std::strcmp(argv[i], "--device") == 0) {
        const std::string wanted = argv[i + 1];
        if (wanted == "null") choice.kind = pg::AudioBackendKind::Null;
        else choice.id = wanted;
      }
    }
    return runSocket(argv[2], shmName, choice);
  }
  return usage();
}

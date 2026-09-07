#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
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
#include "services/MiniaudioBackend.hpp"

static int usage() {
  std::puts(
      "phasegrid-engine\n"
      "  --version\n"
      "  --tone [seconds]      play a 440 Hz test tone on the default device\n"
      "  --render <patch.json> --out <file.wav> [--seconds N] [--sr N] [--block N]");
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

int main(int argc, char** argv) {
  if (argc >= 2 && std::strcmp(argv[1], "--version") == 0) { std::printf("%s\n", pg::engineVersion()); return 0; }
  if (argc >= 2 && std::strcmp(argv[1], "--tone") == 0) return runTone(argc >= 3 ? std::atoi(argv[2]) : 3);
  if (argc >= 2 && std::strcmp(argv[1], "--render") == 0) return runRender(argc, argv);
  return usage();
}

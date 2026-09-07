#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <thread>
#include "app/Tone.hpp"
#include "core/Version.hpp"
#include "services/BlockSplitter.hpp"
#include "services/MiniaudioBackend.hpp"

static int usage() {
  std::puts("phasegrid-engine\n  --version\n  --tone [seconds]      play a 440 Hz test tone on the default device");
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

int main(int argc, char** argv) {
  if (argc >= 2 && std::strcmp(argv[1], "--version") == 0) { std::printf("%s\n", pg::engineVersion()); return 0; }
  if (argc >= 2 && std::strcmp(argv[1], "--tone") == 0) return runTone(argc >= 3 ? std::atoi(argv[2]) : 3);
  return usage();
}

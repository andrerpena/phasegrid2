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
  std::string err;
  pg::DeviceConfig cfg;
  const bool ok = backend.open(cfg, [&](float* out, uint32_t frames, uint32_t channels) {
    splitter.render(out, frames, [&](float* block, uint32_t n) { tone.render(block, n, channels); });
  }, err);
  if (!ok) { std::fprintf(stderr, "open failed: %s\n", err.c_str()); return 1; }
  tone.prepare(backend.sampleRate(), 440.0);
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

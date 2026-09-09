#include <atomic>
#include <chrono>
#include <thread>
#include <catch2/catch_test_macros.hpp>
#include "services/MiniaudioBackend.hpp"

/// The null backend is what the application runs on when asked for `--audio null`, on a machine with
/// no sound hardware, and in continuous integration. It has to behave like a device: open at the rate
/// it was asked for, call the render function from its own thread on a clock, and enumerate as
/// something. If it silently did none of that, a headless run would pass with an engine that never
/// rendered a block.
TEST_CASE("the null backend drives the render callback on its own clock", "[device]") {
  pg::MiniaudioBackend backend{pg::AudioBackendKind::Null};
  REQUIRE(backend.name() == "null");

  std::atomic<uint32_t> calls{0};
  std::atomic<uint32_t> frames{0};
  pg::DeviceConfig config;
  std::string error;
  const bool opened = backend.open(
      config,
      [&](float*, uint32_t n, uint32_t) {
        calls.fetch_add(1, std::memory_order_relaxed);
        frames.fetch_add(n, std::memory_order_relaxed);
      },
      error);
  REQUIRE(opened);
  INFO(error);
  REQUIRE(backend.isOpen());
  REQUIRE(backend.channels() == 2);
  REQUIRE(backend.sampleRate() == config.sampleRate);

  // Real time, so this genuinely waits: a backend that rendered nothing would sit here for the whole
  // second and fail, which is the failure this test exists to produce.
  const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
  while (calls.load(std::memory_order_relaxed) < 2 && std::chrono::steady_clock::now() < deadline)
    std::this_thread::sleep_for(std::chrono::milliseconds(5));
  backend.close();
  REQUIRE(calls.load() >= 2);
  REQUIRE(frames.load() > 0);
  REQUIRE_FALSE(backend.isOpen());

  const auto devices = backend.enumerate();
  REQUIRE_FALSE(devices.empty());
}

#include <catch2/catch_test_macros.hpp>
#include <vector>
#include "services/BlockSplitter.hpp"
#include "services/NullBackend.hpp"

TEST_CASE("BlockSplitter renders fixed blocks for arbitrary periods", "[device]") {
  pg::BlockSplitter splitter;
  splitter.prepare(64, 2);
  uint32_t calls = 0;
  float counter = 0.f;
  auto block = [&](float* out, uint32_t frames) {
    REQUIRE(frames == 64);
    ++calls;
    for (uint32_t i = 0; i < frames; ++i) { out[i * 2] = counter; out[i * 2 + 1] = -counter; counter += 1.f; }
  };
  std::vector<float> out(100 * 2);
  splitter.render(out.data(), 100, block);
  REQUIRE(calls == 2);
  std::vector<float> out2(100 * 2);
  splitter.render(out2.data(), 100, block);
  REQUIRE(calls == 4);
  // Continuity across requests: sample 100 follows sample 99.
  REQUIRE(out[99 * 2] == 99.f);
  REQUIRE(out2[0] == 100.f);
  REQUIRE(out2[0 + 1] == -100.f);
  REQUIRE(out2[99 * 2] == 199.f);
}

TEST_CASE("NullBackend drives the render callback", "[device]") {
  pg::NullBackend backend;
  std::string err;
  uint32_t seen = 0;
  REQUIRE(backend.open(pg::DeviceConfig{}, [&](float*, uint32_t frames, uint32_t ch) { seen += frames * ch; }, err));
  REQUIRE(backend.isOpen());
  std::vector<float> buf(128 * 2);
  backend.pump(buf.data(), 128);
  REQUIRE(seen == 256);
  backend.close();
  REQUIRE_FALSE(backend.isOpen());
}

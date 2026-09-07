#include <unistd.h>

#include <atomic>
#include <catch2/catch_test_macros.hpp>
#include <cstring>
#include <string>
#include <thread>
#include <vector>

#include "services/Telemetry.hpp"
#include "util/RtGuard.hpp"

using namespace pg;

namespace {

/// A unique segment name per test, so a parallel run or a leftover from a crashed run cannot collide.
std::string uniqueName(const char* tag) {
  static std::atomic<int> counter{0};
  return std::string("/pg-test-") + tag + "-" + std::to_string(getpid()) + "-" +
         std::to_string(counter.fetch_add(1));
}

/**
 * The reader half of the seqlock, written the way the TypeScript reader must be.
 *
 * Read the counter, read the payload, read the counter again. Reject if it was odd (a write was in
 * progress) or if it moved (a write happened underneath). This is the shape every reader has to take,
 * so testing it here is testing the contract, not just this implementation.
 */
bool tryRead(const TelemetrySlotHeader* slot, std::vector<float>& out, uint32_t floats) {
  const uint32_t before = slot->seq.load(std::memory_order_relaxed);
  if (before % 2 != 0) return false;
  std::atomic_thread_fence(std::memory_order_acquire);

  const float* payload = reinterpret_cast<const float*>(slot + 1);
  out.assign(payload, payload + floats);

  std::atomic_thread_fence(std::memory_order_acquire);
  return slot->seq.load(std::memory_order_relaxed) == before;
}

}  // namespace

TEST_CASE("a meter slot carries peak, RMS and clip count per channel", "[telemetry]") {
  TelemetryWriter w;
  std::string error;
  REQUIRE(w.create(uniqueName("meter"), 4, 48000.0, 64, error));

  // Two channels, four frames. Left peaks at 0.5; right clips twice.
  const float frames[] = {0.5f, 2.0f, -0.5f, -2.0f, 0.25f, 0.0f, -0.25f, 0.0f};
  w.writeMeter(1, frames, 2, 4, 7);

  const TelemetrySlotHeader* slot = w.slot(1);
  REQUIRE(slot->kind == static_cast<uint32_t>(TelemetryKind::Meter));
  REQUIRE(slot->channels == 2);
  REQUIRE(slot->blockIndex == 7);
  // Even, so the slot is complete and readable.
  REQUIRE(slot->seq.load() % 2 == 0);

  const float* p = w.payload(1);
  REQUIRE(p[0] == 0.5f);   // left peak
  REQUIRE(p[2] == 0.f);    // left never exceeded 1
  REQUIRE(p[3] == 2.0f);   // right peak
  REQUIRE(p[5] == 2.0f);   // right clipped on two frames
}

TEST_CASE("a scope slot carries each channel's samples de-interleaved", "[telemetry]") {
  TelemetryWriter w;
  std::string error;
  REQUIRE(w.create(uniqueName("scope"), 2, 48000.0, 64, error));

  const float frames[] = {1.f, -1.f, 2.f, -2.f, 3.f, -3.f};
  w.writeScope(0, frames, 2, 3, 11);

  const float* p = w.payload(0);
  REQUIRE(w.slot(0)->frames == 3);
  REQUIRE(p[0] == 1.f);
  REQUIRE(p[1] == 2.f);
  REQUIRE(p[2] == 3.f);
  // The second channel starts a full scope window in, not immediately after the frames written, so the
  // reader's stride does not depend on how many frames a particular block happened to carry.
  REQUIRE(p[kTelemetryScopeFrames + 0] == -1.f);
  REQUIRE(p[kTelemetryScopeFrames + 2] == -3.f);
}

TEST_CASE("a reader never observes a half-written slot", "[telemetry]") {
  TelemetryWriter w;
  std::string error;
  REQUIRE(w.create(uniqueName("seqlock"), 1, 48000.0, 64, error));

  // The writer fills every frame with the same value and changes that value every block. A torn read
  // would therefore show two different values inside one payload, which is exactly what to look for:
  // it cannot happen by chance, and it is what a missing fence produces.
  constexpr uint32_t kFrames = 512;
  std::atomic<bool> stop{false};
  std::atomic<int> reads{0}, torn{0}, retries{0};

  std::thread writer([&] {
    std::vector<float> block(kFrames);
    for (uint64_t i = 1; !stop.load(std::memory_order_relaxed); ++i) {
      const float v = static_cast<float>(i % 1000);
      for (uint32_t k = 0; k < kFrames; ++k) block[k] = v;
      w.writeScope(0, block.data(), 1, kFrames, i);
    }
  });

  const TelemetrySlotHeader* slot = w.slot(0);
  std::vector<float> got;
  for (int attempt = 0; attempt < 200000; ++attempt) {
    if (!tryRead(slot, got, kFrames)) {
      retries.fetch_add(1);
      continue;
    }
    reads.fetch_add(1);
    const float first = got[0];
    for (uint32_t k = 1; k < kFrames; ++k)
      if (got[k] != first) {
        torn.fetch_add(1);
        break;
      }
  }
  stop.store(true);
  writer.join();

  INFO("reads " << reads.load() << " retries " << retries.load());
  REQUIRE(reads.load() > 0);
  REQUIRE(torn.load() == 0);
}

TEST_CASE("a slot being written is rejected rather than returned", "[telemetry]") {
  TelemetryWriter w;
  std::string error;
  REQUIRE(w.create(uniqueName("odd"), 1, 48000.0, 64, error));
  const float frames[] = {1.f, 1.f, 1.f, 1.f};
  w.writeScope(0, frames, 1, 4, 1);

  TelemetrySlotHeader* slot = w.slot(0);
  std::vector<float> got;
  REQUIRE(tryRead(slot, got, 4));

  // An odd counter is what a reader sees mid-write. It must decline, not read through it.
  slot->seq.fetch_add(1);
  REQUIRE_FALSE(tryRead(slot, got, 4));
}

TEST_CASE("creating a segment replaces one a previous engine left behind", "[telemetry]") {
  const std::string name = uniqueName("stale");
  std::string error;

  TelemetryWriter first;
  REQUIRE(first.create(name, 2, 48000.0, 64, error));
  const float frames[] = {0.9f, 0.9f};
  first.writeMeter(0, frames, 1, 2, 1);
  REQUIRE(first.payload(0)[0] == 0.9f);

  // Simulate a crash: the mapping goes away without `destroy()` unlinking the name, which is what a
  // killed process leaves behind. A second engine at the same name must get a clean segment, not adopt
  // the corpse of the first one.
  TelemetryWriter second;
  REQUIRE(second.create(name, 2, 48000.0, 64, error));
  REQUIRE(second.payload(0)[0] == 0.f);
  REQUIRE(second.header()->heartbeat.load() == 0);
}

TEST_CASE("a segment reports a valid header", "[telemetry]") {
  TelemetryWriter w;
  std::string error;
  REQUIRE(w.create(uniqueName("header"), 8, 44100.0, 128, error));
  const TelemetryHeader* h = w.header();
  REQUIRE(h->magic == kTelemetryMagic);
  REQUIRE(h->layoutVersion == kTelemetryLayoutVersion);
  REQUIRE(h->slotCount == 8);
  REQUIRE(h->slotBytes == kTelemetrySlotBytes);
  REQUIRE(h->sampleRate == 44100.0);
  REQUIRE(h->blockSize == 128);
  REQUIRE(w.byteLength() == kTelemetryHeaderBytes + 8u * kTelemetrySlotBytes);
}

TEST_CASE("an out-of-range slot is ignored rather than written past the segment", "[telemetry]") {
  TelemetryWriter w;
  std::string error;
  REQUIRE(w.create(uniqueName("range"), 2, 48000.0, 64, error));
  const float frames[] = {1.f, 1.f};
  // The slot index comes from a subscription the client chose, so it is not to be trusted blindly.
  w.writeMeter(99, frames, 1, 2, 1);
  REQUIRE(w.slot(99) == nullptr);
  REQUIRE(w.payload(99) == nullptr);
}

TEST_CASE("writing telemetry allocates nothing", "[telemetry][rt]") {
  TelemetryWriter w;
  std::string error;
  REQUIRE(w.create(uniqueName("rt"), 4, 48000.0, 64, error));

  std::vector<float> block(256, 0.25f);
  // Prove there is something to measure before measuring that it costs no allocations.
  w.writeMeter(0, block.data(), 2, 128, 1);
  REQUIRE(w.payload(0)[0] == 0.25f);

  {
    pg::test::RtScope rt;
    for (uint64_t i = 0; i < 1000; ++i) {
      w.writeMeter(0, block.data(), 2, 128, i);
      w.writeScope(1, block.data(), 2, 128, i);
      w.beat();
    }
  }
  REQUIRE(w.header()->heartbeat.load() == 1000);
}

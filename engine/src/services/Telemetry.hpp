#pragma once
#include <atomic>
#include <cstdint>
#include <cstring>
#include <string>

#include "rt/RtAssert.hpp"

namespace pg {

/**
 * The shared-memory telemetry segment: how the interface watches the running audio without an IPC hop
 * per frame.
 *
 * The engine writes fixed-size slots from the audio thread; a reader in another process maps the same
 * bytes read-only. Neither side ever blocks the other, because a slot is a seqlock rather than a lock:
 * the writer makes the counter odd, writes, then makes it even, and a reader that sees an odd counter or
 * a counter that changed under it simply reads again. A reader can be arbitrarily slow, or die, without
 * the audio thread noticing.
 *
 * `shared/protocol/telemetry.ts` describes these same bytes for the TypeScript side. The two are one
 * layout with two spellings, and a test compares them.
 */

inline constexpr uint32_t kTelemetryMagic = 0x4C544750;   // 'PGTL' little-endian
inline constexpr uint32_t kTelemetryLayoutVersion = 1;
inline constexpr uint32_t kTelemetryHeaderBytes = 64;
inline constexpr uint32_t kTelemetrySlotBytes = 8192;
inline constexpr uint32_t kTelemetryScopeFrames = 1024;
inline constexpr uint32_t kTelemetryMaxChannels = 2;
/// Enough for every display module a milestone-1 patch is likely to hold, and only 512 KiB of memory.
inline constexpr uint32_t kTelemetryMaxSlots = 64;

enum class TelemetryKind : uint32_t { None = 0, Meter = 1, Scope = 2 };

/**
 * One slot's fixed header, followed by its payload inside the same 8 KiB.
 *
 * `seq` is the seqlock counter and the only field written with release ordering; everything else is
 * ordinary memory that the counter protects.
 */
struct TelemetrySlotHeader {
  std::atomic<uint32_t> seq;
  uint32_t kind;
  uint32_t channels;
  uint32_t frames;
  uint64_t blockIndex;
  uint32_t reserved[2];
};
static_assert(sizeof(TelemetrySlotHeader) == 32, "the TypeScript reader assumes a 32-byte slot header");
static_assert(std::atomic<uint32_t>::is_always_lock_free,
              "a seqlock the audio thread writes must not be able to take a lock");

/// Meter payload: peak, RMS and clip count per channel, in that order.
inline constexpr uint32_t kMeterFloatsPerChannel = 3;

/**
 * The segment header. Written once, when the segment is created, and read by anyone attaching.
 *
 * `heartbeat` counts blocks the engine has rendered. A reader watches it to tell "the engine is running
 * and this data is fresh" from "the engine died and these are its last values", which the values
 * themselves cannot say.
 */
struct TelemetryHeader {
  uint32_t magic;
  uint32_t layoutVersion;
  uint32_t slotCount;
  uint32_t slotBytes;
  double sampleRate;
  uint32_t blockSize;
  uint32_t reserved;
  std::atomic<uint64_t> heartbeat;
  uint32_t pad[6];
};
static_assert(sizeof(TelemetryHeader) == kTelemetryHeaderBytes,
              "the TypeScript reader assumes a 64-byte segment header");

/**
 * Owns the mapping. Created on the message thread; slots are written on the audio thread.
 *
 * Creation unlinks any segment already at the name before creating a new one. `shm_open` on an existing
 * name attaches to it rather than failing, so a crashed engine's segment would otherwise be adopted by
 * its replacement and the two would write over each other.
 */
class TelemetryWriter {
public:
  TelemetryWriter() = default;
  ~TelemetryWriter();
  TelemetryWriter(const TelemetryWriter&) = delete;
  TelemetryWriter& operator=(const TelemetryWriter&) = delete;

  /// Message thread. Returns false and sets `error` rather than throwing, because a missing segment is a
  /// degraded engine rather than a broken one: audio must still run with no telemetry.
  bool create(const std::string& name, uint32_t slotCount, double sampleRate, uint32_t blockSize,
              std::string& error);
  void destroy();

  bool valid() const { return base_ != nullptr; }
  const std::string& name() const { return name_; }
  uint32_t slotCount() const { return slotCount_; }
  size_t byteLength() const { return bytes_; }

  /// Audio thread. No allocation, no locks, no syscalls.
  void writeMeter(uint32_t slot, const float* interleaved, uint32_t channels, uint32_t frames,
                  uint64_t blockIndex) noexcept PG_RT_NONBLOCKING;
  void writeScope(uint32_t slot, const float* interleaved, uint32_t channels, uint32_t frames,
                  uint64_t blockIndex) noexcept PG_RT_NONBLOCKING;
  /// Audio thread. One increment per rendered block, so a reader can tell fresh data from stale.
  void beat() noexcept PG_RT_NONBLOCKING;

  TelemetryHeader* header() noexcept { return reinterpret_cast<TelemetryHeader*>(base_); }
  TelemetrySlotHeader* slot(uint32_t index) noexcept;
  float* payload(uint32_t index) noexcept;

private:
  /// Shared by both writers: bump the counter odd, let `fill` write, bump it even.
  template <class Fill>
  void publish(uint32_t index, TelemetryKind kind, uint32_t channels, uint32_t frames,
               uint64_t blockIndex, Fill&& fill) noexcept;

  uint8_t* base_ = nullptr;
  size_t bytes_ = 0;
  uint32_t slotCount_ = 0;
  std::string name_;
};

}  // namespace pg

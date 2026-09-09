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
// 16 KiB, not the 8 KiB the spec names. A scope slot holds `kTelemetryMaxChannels` windows of
// `kTelemetryScopeFrames` floats, which is 8192 bytes on its own, and the slot header still has to fit
// in front of it. At 8 KiB a full stereo scope would have run 32 bytes into the next slot. Today's
// block size is far short of a full window so nothing overflows in practice, which is exactly why this
// is worth pinning down now rather than discovering when the block size changes.
inline constexpr uint32_t kTelemetrySlotBytes = 16384;
inline constexpr uint32_t kTelemetryScopeFrames = 1024;
inline constexpr uint32_t kTelemetryMaxChannels = 2;
/// One slot per watched module plus one per visible wave panel: a patch of forty oscillators still
/// fits, and the segment is 2 MiB.
inline constexpr uint32_t kTelemetryMaxSlots = 128;

/// `Params` is written by the scheduler for any subscribed module that does not publish a kind of its
/// own: the effective value of every parameter, in display units, after modulation. It is how a knob
/// on the interface turns when something is plugged into it.
/// `Preview` is one cycle of what a module would draw for the values it is running with, written by
/// `PreviewPublisher` on the message thread: `channels` is 1 and `frames` is the cycle's length.
/// `Value` is the last frame of the signal a `display.value` was fed, one float per channel: a signed
/// reading, which no other kind carries (a meter's peak is a magnitude, and 0.5 and -0.5 read alike).
/// `Notes` is the picture a note source draws of itself: the notes of the cycle it is playing, in
/// musical time, with the playhead and enough of the meter to rule a grid under them. It is what a
/// piano roll on a module's face is drawn from -- the engine has already worked out where the notes
/// are, and an interface that recomputed them would be guessing at a pattern it cannot parse.
/// `Keys` is which keys are down: one float per MIDI note number, 1 held and 0 up, `frames` of them.
/// What a keyboard on a module's face lights. Per note rather than per voice, so a reader never has to
/// know how many voices the program runs or which lane is which.
enum class TelemetryKind : uint32_t {
  None = 0, Meter = 1, Scope = 2, Params = 3, Preview = 4, Value = 5, Notes = 6, Keys = 7
};

/// "nobody is watching this module". Not a valid slot index, and the default for every instance.
inline constexpr uint32_t kNoTelemetrySlot = 0xFFFFFFFFu;

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

/// Meter payload: held peak, RMS and a clip flag per channel, in that order. The module works these
/// out and holds them; the writer only serialises them, as it does for every other kind.
inline constexpr uint32_t kMeterFloatsPerChannel = 3;
/// Params payload: one float per parameter. Matches `kMaxParamsPerModule`, and a slot holds far more.
inline constexpr uint32_t kTelemetryMaxParams = 64;

/// One note in a `Notes` slot: where it is, what it is, and where it was written.
///
/// `from`/`to` are the character range of the step in the module's text property `textIndex`, which
/// is what lets an interface light up the step in the pattern string as it sounds without parsing
/// the string itself. `flags` bit 0 says the note is sounding right now.
struct TelemetryNote {
  float start;      // cycles from the start of the window
  float length;     // cycles
  float pitch;      // MIDI note number
  float velocity;   // 0..1
  uint32_t from;
  uint32_t to;
  uint32_t textIndex;
  uint32_t flags;
};
static_assert(sizeof(TelemetryNote) == 32, "the TypeScript reader assumes a 32-byte note record");
inline constexpr uint32_t kTelemetryNoteFlagSounding = 1u << 0;
/// Floats in front of the notes: quarters per cycle, quarters per bar, the playhead, and a spare.
inline constexpr uint32_t kTelemetryNoteHeaderFloats = 4;
/// Notes one slot may carry. Matches the pattern engine's per-cycle cap, and a slot holds far more.
inline constexpr uint32_t kTelemetryMaxNotes = 256;
/// Keys a `Keys` slot may carry: one per MIDI note number.
inline constexpr uint32_t kTelemetryMaxKeys = 128;

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
static_assert(sizeof(TelemetrySlotHeader) +
                      kTelemetryMaxChannels * kTelemetryScopeFrames * sizeof(float) <=
                  kTelemetrySlotBytes,
              "a slot must hold its header plus a full scope window per channel");

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
  /// Audio thread. `kMeterFloatsPerChannel` floats per channel: held peak, RMS, clip flag.
  void writeMeter(uint32_t slot, const float* values, uint32_t channels, uint64_t blockIndex) noexcept
      PG_RT_NONBLOCKING;
  /// Audio thread. `interleaved` holds `frames` frames, read as a ring whose oldest frame is `first`:
  /// a module keeping a rolling window publishes it in order without copying it straight first.
  void writeScope(uint32_t slot, const float* interleaved, uint32_t channels, uint32_t frames,
                  uint64_t blockIndex, uint32_t first = 0) noexcept PG_RT_NONBLOCKING;
  /// Audio thread. `count` parameter values, one float each, in descriptor order; `channels` carries
  /// the count and `frames` is 1. Capped at `kTelemetryMaxParams`.
  void writeParams(uint32_t slot, const float* values, uint32_t count, uint64_t blockIndex) noexcept
      PG_RT_NONBLOCKING;
  /// Audio thread. One float per channel: the last frame of the block, signed, as it was on the wire.
  void writeValue(uint32_t slot, const float* values, uint32_t channels, uint64_t blockIndex) noexcept
      PG_RT_NONBLOCKING;
  /// Audio thread. The notes of the window a note source is playing, with the meter to rule a grid
  /// under them and the playhead within it. Capped at `kTelemetryMaxNotes`.
  void writeNotes(uint32_t slot, const TelemetryNote* notes, uint32_t count, float quartersPerCycle,
                  float quartersPerBar, float phase, uint64_t blockIndex) noexcept PG_RT_NONBLOCKING;
  /// Audio thread. One float per MIDI note number, 1 for a key that is down: `count` of them, capped
  /// at `kTelemetryMaxKeys`; `channels` is 1 and `frames` carries the count.
  void writeKeys(uint32_t slot, const float* keys, uint32_t count, uint64_t blockIndex) noexcept
      PG_RT_NONBLOCKING;
  /// Message thread (it is the preview publisher's), but built the same way so a reader cannot tell.
  /// One channel of `count` samples, capped at `kTelemetryScopeFrames`; `index` counts publishes.
  void writePreview(uint32_t slot, const float* samples, uint32_t count, uint64_t index) noexcept;
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

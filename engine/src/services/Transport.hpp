#pragma once
#include <atomic>
#include <cmath>
#include <cstdint>
#include "core/Module.hpp"
#include "core/Result.hpp"
#include "rt/RtAssert.hpp"

namespace pg {

/// Where the transport is, and the only thing the message thread and the audio thread both touch.
///
/// The split is deliberate. Tempo, play/stop and seek are *intent*: the message thread owns them and the
/// audio thread reads them at the top of each block. Position is *fact*: the audio thread owns it, because
/// only it knows how many frames have actually been rendered, and it publishes a snapshot the message loop
/// samples at about 20 Hz for `transport.position`. Nothing reaches into engine state from the timer, and
/// the audio thread never waits for anyone (trap 6).
///
/// The two clocks mean different things and modules rely on the difference (`NotesClip`, `PhaseClock`):
/// `samplePos` is engine time and free-runs whether or not the transport is rolling, so a patch with no
/// transport still has a clock; `ppq` is musical position and only advances while playing. Seeking moves
/// `ppq` alone -- rewinding engine time would make a delay line replay itself.
class Transport {
public:
  // ---------------------------------------------------------------- message thread

  /// Before the device opens, and again after it reopens at a different rate. Not while it is running.
  void prepare(double sampleRate) noexcept { sampleRate_.store(sampleRate, std::memory_order_relaxed); }

  void play() noexcept { playing_.store(true, std::memory_order_relaxed); }
  void stop() noexcept { playing_.store(false, std::memory_order_relaxed); }

  Result setTempo(double bpm) {
    if (!(bpm >= 1.0 && bpm <= 999.0)) return Result::fail("E_SCHEMA", "tempo must be 1..999");
    tempo_.store(bpm, std::memory_order_relaxed);
    return {};
  }

  /// The project's meter. The denominator is a note value, so only powers of two are meaningful; anything
  /// else would make `quartersPerBar` a number no notation can draw.
  Result setTimeSignature(uint32_t numerator, uint32_t denominator) {
    if (numerator < 1 || numerator > 64) return Result::fail("E_SCHEMA", "time signature numerator must be 1..64");
    if (denominator < 1 || denominator > 64 || (denominator & (denominator - 1)) != 0)
      return Result::fail("E_SCHEMA", "time signature denominator must be a power of two, 1..64");
    numerator_.store(numerator, std::memory_order_relaxed);
    denominator_.store(denominator, std::memory_order_relaxed);
    return {};
  }

  /// The project's key and scale, as `TransportSnapshot` carries them: a pitch class and a twelve-bit
  /// mask of the semitones above it. An empty scale would quantise every note to nothing, so it is refused.
  Result setScale(uint32_t root, uint32_t mask) {
    if (root > 11) return Result::fail("E_SCHEMA", "scale root must be a pitch class, 0..11");
    if (mask == 0 || mask > 0xFFFu) return Result::fail("E_SCHEMA", "scale must have between one and twelve pitch classes");
    scaleRoot_.store(root, std::memory_order_relaxed);
    scaleMask_.store(mask, std::memory_order_relaxed);
    return {};
  }

  /// Requests a musical position. The audio thread applies it at the top of its next block and
  /// acknowledges by serial, which is how `state()` can answer truthfully before that happens -- and
  /// keeps answering truthfully when there is no audio thread at all, as in `--render` and in tests.
  Result seek(double ppq) {
    if (!(ppq >= 0.0) || !std::isfinite(ppq)) return Result::fail("E_SCHEMA", "ppq must be a finite position >= 0");
    seekPpq_.store(ppq, std::memory_order_relaxed);
    seekSerial_.fetch_add(1, std::memory_order_release);
    return {};
  }

  /// What to tell a client: intent for tempo and play state, published fact for position.
  TransportSnapshot state() const noexcept {
    TransportSnapshot t;
    t.tempo = tempo_.load(std::memory_order_relaxed);
    t.playing = playing_.load(std::memory_order_relaxed);
    t.timeSigNumerator = numerator_.load(std::memory_order_relaxed);
    t.timeSigDenominator = denominator_.load(std::memory_order_relaxed);
    t.scaleRoot = scaleRoot_.load(std::memory_order_relaxed);
    t.scaleMask = scaleMask_.load(std::memory_order_relaxed);
    const Published p = published();
    t.samplePos = p.samplePos;
    const uint64_t requested = seekSerial_.load(std::memory_order_relaxed);
    t.ppq = p.seekAck == requested ? p.ppq : seekPpq_.load(std::memory_order_relaxed);
    return t;
  }

  // ---------------------------------------------------------------- audio thread

  /// The snapshot for the block about to be rendered, published for the message loop on the way out.
  /// Advances afterwards, so the first block of a run starts at the position that was seeked to.
  TransportSnapshot advance(uint32_t frames) noexcept PG_RT_NONBLOCKING {
    const uint64_t requested = seekSerial_.load(std::memory_order_acquire);
    if (requested != seekAck_) {
      seekAck_ = requested;
      ppq_ = seekPpq_.load(std::memory_order_relaxed);
    }
    TransportSnapshot t;
    t.tempo = tempo_.load(std::memory_order_relaxed);
    t.playing = playing_.load(std::memory_order_relaxed);
    t.timeSigNumerator = numerator_.load(std::memory_order_relaxed);
    t.timeSigDenominator = denominator_.load(std::memory_order_relaxed);
    t.scaleRoot = scaleRoot_.load(std::memory_order_relaxed);
    t.scaleMask = scaleMask_.load(std::memory_order_relaxed);
    t.ppq = ppq_;
    t.samplePos = samplePos_;

    const double sampleRate = sampleRate_.load(std::memory_order_relaxed);
    samplePos_ += frames;   // engine time, whether or not the transport is rolling
    if (t.playing && sampleRate > 0.0) ppq_ += static_cast<double>(frames) * t.tempo / (60.0 * sampleRate);
    publish();   // where the playhead is *now*, not where this block began: a display wants the newest
    return t;
  }

private:
  struct Published { double ppq; uint64_t samplePos; uint64_t seekAck; };

  /// Sequence-locked so the message thread never sees a position from two different blocks. The writer
  /// only ever stores, so the audio thread cannot be delayed by a reader.
  void publish() noexcept PG_RT_NONBLOCKING {
    const uint32_t seq = pubSeq_.load(std::memory_order_relaxed);
    pubSeq_.store(seq + 1, std::memory_order_relaxed);         // odd: a write is in progress
    std::atomic_thread_fence(std::memory_order_release);
    pubPpq_.store(ppq_, std::memory_order_relaxed);
    pubSamplePos_.store(samplePos_, std::memory_order_relaxed);
    pubSeekAck_.store(seekAck_, std::memory_order_relaxed);
    std::atomic_thread_fence(std::memory_order_release);
    pubSeq_.store(seq + 2, std::memory_order_relaxed);
  }

  Published published() const noexcept {
    // A reader retry is unbounded in theory, so it is bounded here instead: after enough attempts the
    // fields are read unguarded. The worst case is a playhead drawn one block out of date, and the
    // alternative -- a message loop spinning because the audio thread stopped mid-write -- is worse.
    for (int attempt = 0; attempt < 64; ++attempt) {
      const uint32_t before = pubSeq_.load(std::memory_order_acquire);
      if ((before & 1u) != 0u) continue;
      const Published p{pubPpq_.load(std::memory_order_relaxed), pubSamplePos_.load(std::memory_order_relaxed),
                        pubSeekAck_.load(std::memory_order_relaxed)};
      std::atomic_thread_fence(std::memory_order_acquire);
      if (pubSeq_.load(std::memory_order_relaxed) == before) return p;
    }
    return {pubPpq_.load(std::memory_order_relaxed), pubSamplePos_.load(std::memory_order_relaxed),
            pubSeekAck_.load(std::memory_order_relaxed)};
  }

  // Intent: written by the message thread, read by the audio thread.
  std::atomic<double> tempo_{120.0};
  std::atomic<bool> playing_{false};
  std::atomic<double> sampleRate_{48000.0};
  std::atomic<uint32_t> numerator_{4};
  std::atomic<uint32_t> denominator_{4};
  std::atomic<uint32_t> scaleRoot_{0};
  std::atomic<uint32_t> scaleMask_{0xFFFu};
  std::atomic<double> seekPpq_{0.0};
  std::atomic<uint64_t> seekSerial_{0};

  // Position: audio thread only.
  double ppq_ = 0.0;
  uint64_t samplePos_ = 0;
  uint64_t seekAck_ = 0;

  // Published position: written by the audio thread, read by the message thread.
  std::atomic<uint32_t> pubSeq_{0};
  std::atomic<double> pubPpq_{0.0};
  std::atomic<uint64_t> pubSamplePos_{0};
  std::atomic<uint64_t> pubSeekAck_{0};
};

}  // namespace pg

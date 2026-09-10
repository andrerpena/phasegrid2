#pragma once
#include <atomic>
#include <cstdint>
#include <memory>
#include <string>
#include <thread>
#include <vector>
#include "core/Result.hpp"
#include "rt/RtAssert.hpp"

namespace pg {

/**
 * Records what the device is actually being handed, to a WAV, on request.
 *
 * This exists because four rounds of "the sine sounds rough" were diagnosed against offline renders
 * while the fault was in the live callback, and nothing could record the live callback. Now something
 * can: `audio.capture.start` arms it, the device thread pushes every frame it renders into a ring, a
 * writer thread drains the ring to disk, and `audio.capture.stop` says how many frames were written
 * and how many the ring had to drop. A capture is a copy of the real output, not a re-render of it.
 *
 * Audio thread: `push` is a copy into a preallocated ring guarded by two atomics -- no lock, no
 * allocation, no syscall -- and drops rather than waits when the writer falls behind. Message thread:
 * start and stop. The writer thread owns the encoder and touches nothing the audio thread touches
 * except the ring's tail.
 */
class Capture {
public:
  Capture();
  ~Capture();

  /// Message thread. Opens the file and arms the ring; `E_IO` if the file cannot be created, `E_BUSY`
  /// if a capture is already running.
  Result start(const std::string& path, double sampleRate, uint32_t channels);
  /// Message thread. Disarms, drains what is left, closes the file. Idempotent.
  struct Summary { std::string path; uint64_t frames = 0; uint64_t droppedFrames = 0; };
  Summary stop();
  bool running() const { return armed_.load(std::memory_order_acquire); }

  /// Audio thread. `interleaved` is what the device was just handed; copied whole or not at all.
  void push(const float* interleaved, uint32_t frames, uint32_t channels) noexcept PG_RT_NONBLOCKING;

private:
  void writerLoop();

  struct Encoder;
  std::unique_ptr<Encoder> encoder_;
  std::thread writer_;
  std::atomic<bool> armed_{false};
  std::atomic<bool> writerShouldStop_{false};

  // Single producer (device thread), single consumer (writer): head is written only by the producer,
  // tail only by the consumer, each read the other's with acquire.
  std::vector<float> ring_;
  std::atomic<size_t> head_{0};
  std::atomic<size_t> tail_{0};
  uint32_t channels_ = 2;
  std::atomic<uint64_t> pushedFrames_{0};
  std::atomic<uint64_t> droppedFrames_{0};
  uint64_t writtenFrames_ = 0;   // writer thread only
  std::string path_;
};

}  // namespace pg

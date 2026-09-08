#include "services/Telemetry.hpp"

#include <fcntl.h>
#include <sys/mman.h>
#include <unistd.h>

#include <algorithm>
#include <cerrno>
#include <cmath>


namespace pg {

TelemetryWriter::~TelemetryWriter() { destroy(); }

bool TelemetryWriter::create(const std::string& name, uint32_t slotCount, double sampleRate,
                             uint32_t blockSize, std::string& error) {
  destroy();
  if (slotCount == 0 || slotCount > kTelemetryMaxSlots) {
    error = "slotCount must be 1.." + std::to_string(kTelemetryMaxSlots);
    return false;
  }
  const size_t bytes = kTelemetryHeaderBytes + static_cast<size_t>(slotCount) * kTelemetrySlotBytes;

  // Unlink first. `shm_open` with O_CREAT attaches to an existing segment instead of failing, so a
  // segment left behind by a crashed engine would be adopted by this one and both would write into it.
  shm_unlink(name.c_str());
  const int fd = shm_open(name.c_str(), O_CREAT | O_EXCL | O_RDWR, 0600);
  if (fd < 0) {
    error = "shm_open " + name + ": " + std::strerror(errno);
    return false;
  }
  if (ftruncate(fd, static_cast<off_t>(bytes)) != 0) {
    error = "ftruncate " + name + ": " + std::strerror(errno);
    ::close(fd);
    shm_unlink(name.c_str());
    return false;
  }
  void* mapped = mmap(nullptr, bytes, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
  // The mapping holds the segment open by itself; keeping the descriptor would leak one per create.
  ::close(fd);
  if (mapped == MAP_FAILED) {
    error = "mmap " + name + ": " + std::strerror(errno);
    shm_unlink(name.c_str());
    return false;
  }

  base_ = static_cast<uint8_t*>(mapped);
  bytes_ = bytes;
  slotCount_ = slotCount;
  name_ = name;
  std::memset(base_, 0, bytes_);

  TelemetryHeader* h = header();
  h->slotCount = slotCount;
  h->slotBytes = kTelemetrySlotBytes;
  h->sampleRate = sampleRate;
  h->blockSize = blockSize;
  h->layoutVersion = kTelemetryLayoutVersion;
  h->heartbeat.store(0, std::memory_order_relaxed);
  // The magic goes last, with release ordering: a reader that sees it is guaranteed to see a fully
  // written header behind it, so there is no window where the segment looks valid but is not.
  std::atomic_thread_fence(std::memory_order_release);
  h->magic = kTelemetryMagic;
  return true;
}

void TelemetryWriter::destroy() {
  if (base_ == nullptr) return;
  munmap(base_, bytes_);
  shm_unlink(name_.c_str());
  base_ = nullptr;
  bytes_ = 0;
  slotCount_ = 0;
  name_.clear();
}

TelemetrySlotHeader* TelemetryWriter::slot(uint32_t index) noexcept {
  if (base_ == nullptr || index >= slotCount_) return nullptr;
  return reinterpret_cast<TelemetrySlotHeader*>(base_ + kTelemetryHeaderBytes +
                                                static_cast<size_t>(index) * kTelemetrySlotBytes);
}

float* TelemetryWriter::payload(uint32_t index) noexcept {
  TelemetrySlotHeader* s = slot(index);
  return s == nullptr ? nullptr : reinterpret_cast<float*>(s + 1);
}

template <class Fill>
void TelemetryWriter::publish(uint32_t index, TelemetryKind kind, uint32_t channels, uint32_t frames,
                              uint64_t blockIndex, Fill&& fill) noexcept {
  TelemetrySlotHeader* s = slot(index);
  if (s == nullptr) return;

  // Odd means "being written". A reader that sees an odd counter retries rather than reading a slot
  // that is half old and half new.
  const uint32_t start = s->seq.load(std::memory_order_relaxed);
  s->seq.store(start + 1, std::memory_order_relaxed);
  std::atomic_thread_fence(std::memory_order_release);

  s->kind = static_cast<uint32_t>(kind);
  s->channels = channels;
  s->frames = frames;
  s->blockIndex = blockIndex;
  fill(reinterpret_cast<float*>(s + 1));

  // Release, so every payload write above is visible to any reader that sees this counter. Without it a
  // reader can observe an even counter over data that has not landed, and get a slot that is half new.
  //
  // NOTE FOR ANYONE TEMPTED TO SIMPLIFY THIS. No test in this repository fails if the ordering here is
  // weakened to relaxed; that was checked by doing it. Memory-ordering bugs are not reliably observable
  // by asserting on values, because whether the reordering actually happens depends on the compiler's
  // mood and the processor's. The ordering is required by the memory model, not by a failing test, and a
  // green suite is not evidence that it is unnecessary. Thread sanitizers do not settle it either: a
  // seqlock reads the payload while the writer writes it on purpose, so a sanitizer reports a correct
  // implementation as a race.
  s->seq.store(start + 2, std::memory_order_release);
}

void TelemetryWriter::writeMeter(uint32_t slot, const float* interleaved, uint32_t channels,
                                 uint32_t frames, uint64_t blockIndex) noexcept PG_RT_NONBLOCKING {
  const uint32_t ch = std::min(channels, kTelemetryMaxChannels);
  publish(slot, TelemetryKind::Meter, ch, frames, blockIndex, [&](float* out) noexcept {
    for (uint32_t c = 0; c < ch; ++c) {
      float peak = 0.f, sum = 0.f;
      uint32_t clipped = 0;
      for (uint32_t i = 0; i < frames; ++i) {
        const float v = interleaved[i * channels + c];
        const float a = std::fabs(v);
        if (a > peak) peak = a;
        sum += v * v;
        if (a > 1.f) ++clipped;
      }
      out[c * kMeterFloatsPerChannel + 0] = peak;
      out[c * kMeterFloatsPerChannel + 1] = frames > 0 ? std::sqrt(sum / static_cast<float>(frames)) : 0.f;
      out[c * kMeterFloatsPerChannel + 2] = static_cast<float>(clipped);
    }
  });
}

void TelemetryWriter::writeScope(uint32_t slot, const float* interleaved, uint32_t channels,
                                 uint32_t frames, uint64_t blockIndex) noexcept PG_RT_NONBLOCKING {
  const uint32_t ch = std::min(channels, kTelemetryMaxChannels);
  // A block is far shorter than the scope window, so this writes what it has and reports how many.
  // Stitching successive blocks into a rolling window is the reader's job, where a slow reader that
  // misses blocks degrades into a coarser picture instead of stalling the audio thread.
  const uint32_t n = std::min(frames, kTelemetryScopeFrames);
  publish(slot, TelemetryKind::Scope, ch, n, blockIndex, [&](float* out) noexcept {
    for (uint32_t c = 0; c < ch; ++c)
      for (uint32_t i = 0; i < n; ++i)
        out[c * kTelemetryScopeFrames + i] = interleaved[i * channels + c];
  });
}

void TelemetryWriter::writeParams(uint32_t slot, const float* values, uint32_t count,
                                  uint64_t blockIndex) noexcept PG_RT_NONBLOCKING {
  const uint32_t n = std::min(count, kTelemetryMaxParams);
  publish(slot, TelemetryKind::Params, n, 1, blockIndex, [&](float* out) noexcept {
    for (uint32_t i = 0; i < n; ++i) out[i] = values[i];
  });
}

void TelemetryWriter::beat() noexcept PG_RT_NONBLOCKING {
  if (base_ == nullptr) return;
  header()->heartbeat.fetch_add(1, std::memory_order_relaxed);
}

}  // namespace pg

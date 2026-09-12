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

void TelemetryWriter::writeMeter(uint32_t slot, const float* values, uint32_t channels,
                                 uint64_t blockIndex) noexcept PG_RT_NONBLOCKING {
  const uint32_t ch = std::min(channels, kTelemetryMaxChannels);
  publish(slot, TelemetryKind::Meter, ch, 1, blockIndex, [&](float* out) noexcept {
    for (uint32_t i = 0; i < ch * kMeterFloatsPerChannel; ++i) out[i] = values[i];
  });
}

void TelemetryWriter::writeScope(uint32_t slot, const float* interleaved, uint32_t channels,
                                 uint32_t frames, uint64_t blockIndex, uint32_t first) noexcept
    PG_RT_NONBLOCKING {
  const uint32_t ch = std::min(channels, kTelemetryMaxChannels);
  // The window is the writer's to keep, not the reader's to stitch: a block is a few milliseconds and
  // a reader at frame rate would see one block in six, so a picture assembled on that side would be
  // mostly holes. A module keeps a rolling window and publishes the whole of it every block; a slow
  // reader then merely sees fewer of the windows, each of them complete.
  const uint32_t n = std::min(frames, kTelemetryScopeFrames);
  const uint32_t start = n == 0 ? 0 : first % n;
  publish(slot, TelemetryKind::Scope, ch, n, blockIndex, [&](float* out) noexcept {
    for (uint32_t c = 0; c < ch; ++c) {
      float* dst = out + c * kTelemetryScopeFrames;
      // Two straight runs rather than a modulo per sample: the ring's tail from `first`, then its head.
      const uint32_t tail = n - start;
      for (uint32_t i = 0; i < tail; ++i) dst[i] = interleaved[(start + i) * channels + c];
      for (uint32_t i = 0; i < start; ++i) dst[tail + i] = interleaved[i * channels + c];
    }
  });
}

void TelemetryWriter::writeParams(uint32_t slot, const float* values, uint32_t count,
                                  uint64_t blockIndex) noexcept PG_RT_NONBLOCKING {
  const uint32_t n = std::min(count, kTelemetryMaxParams);
  publish(slot, TelemetryKind::Params, n, 1, blockIndex, [&](float* out) noexcept {
    for (uint32_t i = 0; i < n; ++i) out[i] = values[i];
  });
}

void TelemetryWriter::writeValue(uint32_t slot, const float* values, uint32_t channels,
                                 uint64_t blockIndex) noexcept PG_RT_NONBLOCKING {
  const uint32_t ch = std::min(channels, kTelemetryMaxChannels);
  publish(slot, TelemetryKind::Value, ch, 1, blockIndex, [&](float* out) noexcept {
    for (uint32_t c = 0; c < ch; ++c) out[c] = values[c];
  });
}

void TelemetryWriter::writeNotes(uint32_t slot, const TelemetryNote* notes, uint32_t count,
                                 float quartersPerCycle, float quartersPerBar, float phase,
                                 uint64_t blockIndex) noexcept PG_RT_NONBLOCKING {
  const uint32_t n = std::min(count, kTelemetryMaxNotes);
  publish(slot, TelemetryKind::Notes, 1, n, blockIndex, [&](float* out) noexcept {
    out[0] = quartersPerCycle;
    out[1] = quartersPerBar;
    out[2] = phase;
    out[3] = 0.f;
    // A plain copy of POD records into the payload, past the four floats of preamble. The record is
    // the same 32 bytes on both sides of the segment; `telemetry.ts` decodes the same layout.
    std::memcpy(out + kTelemetryNoteHeaderFloats, notes, static_cast<size_t>(n) * sizeof(TelemetryNote));
  });
}

void TelemetryWriter::writeKeys(uint32_t slot, const float* keys, uint32_t count,
                                uint64_t blockIndex) noexcept PG_RT_NONBLOCKING {
  const uint32_t n = std::min(count, kTelemetryMaxKeys);
  publish(slot, TelemetryKind::Keys, 1, n, blockIndex, [&](float* out) noexcept {
    for (uint32_t i = 0; i < n; ++i) out[i] = keys[i];
  });
}

void TelemetryWriter::writePreview(uint32_t slot, const float* samples, uint32_t count,
                                   uint64_t index) noexcept {
  const uint32_t n = std::min(count, kTelemetryScopeFrames);
  publish(slot, TelemetryKind::Preview, 1, n, index, [&](float* out) noexcept {
    for (uint32_t i = 0; i < n; ++i) out[i] = samples[i];
  });
}

void TelemetryWriter::writeEnvelope(uint32_t slot, const float* picture, uint32_t count,
                                    uint64_t index) noexcept {
  const uint32_t n = std::min(count, kTelemetryScopeFrames);
  publish(slot, TelemetryKind::Envelope, 1, n, index, [&](float* out) noexcept {
    for (uint32_t i = 0; i < n; ++i) out[i] = picture[i];
  });
}

void TelemetryWriter::beat() noexcept PG_RT_NONBLOCKING {
  if (base_ == nullptr) return;
  header()->heartbeat.fetch_add(1, std::memory_order_relaxed);
}

}  // namespace pg

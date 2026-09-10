#include "services/Capture.hpp"
#include <algorithm>
#include <chrono>
#include "miniaudio.h"

namespace pg {

struct Capture::Encoder {
  ma_encoder encoder{};
  bool open = false;
};

namespace {
/// Ten seconds of stereo at 48 kHz. A writer thread that cannot keep up with that is not the audio
/// thread's problem to solve; the frames are dropped and counted.
constexpr size_t kRingFrames = 48000 * 10;
}  // namespace

Capture::Capture() : encoder_(std::make_unique<Encoder>()) {}
Capture::~Capture() { stop(); }

Result Capture::start(const std::string& path, double sampleRate, uint32_t channels) {
  if (armed_.load(std::memory_order_acquire)) return Result::fail("E_BUSY", "a capture is already running: " + path_);
  ma_encoder_config cfg = ma_encoder_config_init(ma_encoding_format_wav, ma_format_f32, channels, static_cast<ma_uint32>(sampleRate));
  if (ma_encoder_init_file(path.c_str(), &cfg, &encoder_->encoder) != MA_SUCCESS)
    return Result::fail("E_IO", "cannot create " + path);
  encoder_->open = true;
  path_ = path;
  channels_ = channels;
  ring_.assign(kRingFrames * channels, 0.f);   // allocated here, on the message thread, before arming
  head_.store(0, std::memory_order_relaxed);
  tail_.store(0, std::memory_order_relaxed);
  pushedFrames_.store(0, std::memory_order_relaxed);
  droppedFrames_.store(0, std::memory_order_relaxed);
  writtenFrames_ = 0;
  writerShouldStop_.store(false, std::memory_order_relaxed);
  writer_ = std::thread([this] { writerLoop(); });
  armed_.store(true, std::memory_order_release);
  return {};
}

Capture::Summary Capture::stop() {
  Summary s;
  s.path = path_;
  if (!encoder_->open && !writer_.joinable()) return s;
  armed_.store(false, std::memory_order_release);
  writerShouldStop_.store(true, std::memory_order_release);
  if (writer_.joinable()) writer_.join();   // the loop drains the ring before it returns
  if (encoder_->open) {
    ma_encoder_uninit(&encoder_->encoder);
    encoder_->open = false;
  }
  s.frames = writtenFrames_;
  s.droppedFrames = droppedFrames_.load(std::memory_order_relaxed);
  return s;
}

void Capture::push(const float* interleaved, uint32_t frames, uint32_t channels) noexcept {
  if (!armed_.load(std::memory_order_acquire) || channels != channels_) return;
  const size_t want = static_cast<size_t>(frames) * channels;
  const size_t capacity = ring_.size();
  const size_t head = head_.load(std::memory_order_relaxed);
  const size_t tail = tail_.load(std::memory_order_acquire);
  const size_t used = head >= tail ? head - tail : capacity - (tail - head);
  if (capacity - used - 1 < want) {   // one slot kept free so full and empty differ
    droppedFrames_.fetch_add(frames, std::memory_order_relaxed);
    return;
  }
  const size_t first = std::min(want, capacity - head);
  std::copy_n(interleaved, first, ring_.data() + head);
  std::copy_n(interleaved + first, want - first, ring_.data());
  head_.store((head + want) % capacity, std::memory_order_release);
  pushedFrames_.fetch_add(frames, std::memory_order_relaxed);
}

void Capture::writerLoop() {
  std::vector<float> chunk;
  for (;;) {
    const size_t head = head_.load(std::memory_order_acquire);
    const size_t tail = tail_.load(std::memory_order_relaxed);
    const size_t capacity = ring_.size();
    const size_t available = head >= tail ? head - tail : capacity - (tail - head);
    const size_t wholeFrames = (available / channels_) * channels_;
    if (wholeFrames > 0) {
      chunk.resize(wholeFrames);
      const size_t first = std::min(wholeFrames, capacity - tail);
      std::copy_n(ring_.data() + tail, first, chunk.data());
      std::copy_n(ring_.data(), wholeFrames - first, chunk.data() + first);
      tail_.store((tail + wholeFrames) % capacity, std::memory_order_release);
      ma_uint64 written = 0;
      ma_encoder_write_pcm_frames(&encoder_->encoder, chunk.data(), wholeFrames / channels_, &written);
      writtenFrames_ += written;
      continue;   // keep draining while there is something to drain
    }
    if (writerShouldStop_.load(std::memory_order_acquire)) return;
    std::this_thread::sleep_for(std::chrono::milliseconds(10));
  }
}

}  // namespace pg

#pragma once
#include <memory>
#include "services/AudioDevice.hpp"

namespace pg {

/// Which of miniaudio's backends the context is built on.
enum class AudioBackendKind : uint8_t {
  /// Whatever the platform has: CoreAudio here, and the device is heard.
  Native,
  /// miniaudio's own null backend: a device thread with real-time timing and nowhere to send the
  /// samples. What the application runs on when asked for `--audio null`, on a machine with no
  /// sound hardware, and in continuous integration. Everything downstream of the callback is the
  /// same code as with a real device, which is the point of using it rather than a fake.
  Null,
};

class MiniaudioBackend final : public AudioDeviceBackend {
public:
  explicit MiniaudioBackend(AudioBackendKind kind = AudioBackendKind::Native);
  ~MiniaudioBackend() override;
  std::string name() const override { return kind_ == AudioBackendKind::Null ? "null" : "miniaudio"; }
  std::vector<DeviceInfo> enumerate() override;
  bool open(const DeviceConfig& config, RenderFn render, std::string& error) override;
  void close() override;
  bool isOpen() const override { return open_; }
  double sampleRate() const override { return sampleRate_; }
  uint32_t channels() const override { return channels_; }
  uint32_t periodFrames() const override { return periodFrames_; }

  // Called from the device thread.
  void onData(float* out, uint32_t frames, uint32_t channels) { if (render_) render_(out, frames, channels); }

private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
  AudioBackendKind kind_;
  RenderFn render_;
  bool open_ = false;
  double sampleRate_ = 0.0;
  uint32_t channels_ = 0;
  uint32_t periodFrames_ = 0;
};

}  // namespace pg

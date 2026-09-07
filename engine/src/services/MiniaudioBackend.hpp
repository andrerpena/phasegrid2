#pragma once
#include <memory>
#include "services/AudioDevice.hpp"

namespace pg {

class MiniaudioBackend final : public AudioDeviceBackend {
public:
  MiniaudioBackend();
  ~MiniaudioBackend() override;
  std::string name() const override { return "miniaudio"; }
  std::vector<DeviceInfo> enumerate() override;
  bool open(const DeviceConfig& config, RenderFn render, std::string& error) override;
  void close() override;
  bool isOpen() const override { return open_; }
  double sampleRate() const override { return sampleRate_; }
  uint32_t channels() const override { return channels_; }

  // Called from the device thread.
  void onData(float* out, uint32_t frames, uint32_t channels) { if (render_) render_(out, frames, channels); }

private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
  RenderFn render_;
  bool open_ = false;
  double sampleRate_ = 0.0;
  uint32_t channels_ = 0;
};

}  // namespace pg

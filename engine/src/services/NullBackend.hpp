#pragma once
#include "services/AudioDevice.hpp"

namespace pg {

/// No device. Used by the offline renderer and tests; `pump` plays the role of the device callback.
class NullBackend final : public AudioDeviceBackend {
public:
  std::string name() const override { return "null"; }
  std::vector<DeviceInfo> enumerate() override { return {DeviceInfo{"null", "Null Output", true}}; }
  bool open(const DeviceConfig& config, RenderFn render, std::string&) override {
    config_ = config; render_ = std::move(render); open_ = true; return true;
  }
  void close() override { open_ = false; render_ = nullptr; }
  bool isOpen() const override { return open_; }
  double sampleRate() const override { return config_.sampleRate; }
  uint32_t channels() const override { return config_.channels; }
  uint32_t periodFrames() const override { return config_.periodFrames; }

  void pump(float* interleavedOut, uint32_t frames) {
    if (render_) render_(interleavedOut, frames, config_.channels);
  }

private:
  DeviceConfig config_;
  RenderFn render_;
  bool open_ = false;
};

}  // namespace pg

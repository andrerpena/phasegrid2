#pragma once
#include <cstdint>
#include <functional>
#include <string>
#include <vector>

namespace pg {

struct DeviceInfo {
  std::string id;
  std::string name;
  bool isDefault = false;
};

struct DeviceConfig {
  std::string deviceId;          // empty = system default
  double sampleRate = 48000.0;
  uint32_t periodFrames = 128;   // requested device period
  uint32_t channels = 2;
};

/// Called on the device's real-time thread. Must fill frames*channels interleaved floats.
using RenderFn = std::function<void(float* interleavedOut, uint32_t frames, uint32_t channels)>;

class AudioDeviceBackend {
public:
  virtual ~AudioDeviceBackend() = default;
  virtual std::string name() const = 0;
  virtual std::vector<DeviceInfo> enumerate() = 0;
  virtual bool open(const DeviceConfig& config, RenderFn render, std::string& error) = 0;
  virtual void close() = 0;
  virtual bool isOpen() const = 0;
  virtual double sampleRate() const = 0;   // actual rate after open
  virtual uint32_t channels() const = 0;
};

}  // namespace pg

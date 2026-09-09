#include "services/MiniaudioBackend.hpp"
#include <algorithm>
#include <cctype>
#include <cstring>
#include <vector>
#include "miniaudio.h"

namespace pg {

struct MiniaudioBackend::Impl {
  ma_context context{};
  bool contextInit = false;
  ma_device device{};
  bool deviceInit = false;
  std::vector<ma_device_info> playback;   // cache from last enumerate(); ids are indices
};

static void dataCallback(ma_device* dev, void* out, const void*, ma_uint32 frames) {
  auto* self = static_cast<MiniaudioBackend*>(dev->pUserData);
  self->onData(static_cast<float*>(out), frames, dev->playback.channels);
}

MiniaudioBackend::MiniaudioBackend(AudioBackendKind kind) : impl_(std::make_unique<Impl>()), kind_(kind) {
  if (kind == AudioBackendKind::Null) {
    // Asked for by name rather than left to fall back to: miniaudio only tries the null backend when
    // every real one failed, and a machine with a working device would then never be silent.
    const ma_backend backends[] = {ma_backend_null};
    impl_->contextInit = ma_context_init(backends, 1, nullptr, &impl_->context) == MA_SUCCESS;
    return;
  }
  impl_->contextInit = ma_context_init(nullptr, 0, nullptr, &impl_->context) == MA_SUCCESS;
}

MiniaudioBackend::~MiniaudioBackend() {
  close();
  if (impl_->contextInit) ma_context_uninit(&impl_->context);
}

std::vector<DeviceInfo> MiniaudioBackend::enumerate() {
  std::vector<DeviceInfo> out;
  if (!impl_->contextInit) return out;
  ma_device_info* infos = nullptr; ma_uint32 count = 0;
  if (ma_context_get_devices(&impl_->context, &infos, &count, nullptr, nullptr) != MA_SUCCESS) return out;
  impl_->playback.assign(infos, infos + count);
  for (ma_uint32 i = 0; i < count; ++i)
    out.push_back(DeviceInfo{std::to_string(i), infos[i].name, infos[i].isDefault != 0});
  return out;
}

bool MiniaudioBackend::open(const DeviceConfig& config, RenderFn render, std::string& error) {
  if (!impl_->contextInit) { error = "miniaudio context init failed"; return false; }
  close();
  render_ = std::move(render);
  ma_device_config cfg = ma_device_config_init(ma_device_type_playback);
  cfg.playback.format = ma_format_f32;
  cfg.playback.channels = config.channels;
  cfg.sampleRate = static_cast<ma_uint32>(config.sampleRate);
  cfg.periodSizeInFrames = config.periodFrames;
  cfg.dataCallback = dataCallback;
  cfg.pUserData = this;
  if (!config.deviceId.empty()) {
    const bool allDigits = std::all_of(config.deviceId.begin(), config.deviceId.end(),
                                        [](unsigned char c) { return std::isdigit(c) != 0; });
    if (!allDigits) { error = "invalid device id " + config.deviceId; return false; }
    if (impl_->playback.empty()) enumerate();
    const size_t idx = std::stoul(config.deviceId);
    if (idx >= impl_->playback.size()) { error = "unknown device id " + config.deviceId; return false; }
    cfg.playback.pDeviceID = &impl_->playback[idx].id;
  }
  if (ma_device_init(&impl_->context, &cfg, &impl_->device) != MA_SUCCESS) { error = "ma_device_init failed"; return false; }
  impl_->deviceInit = true;
  if (ma_device_start(&impl_->device) != MA_SUCCESS) { error = "ma_device_start failed"; close(); return false; }
  sampleRate_ = impl_->device.sampleRate;
  channels_ = impl_->device.playback.channels;
  open_ = true;
  return true;
}

void MiniaudioBackend::close() {
  if (impl_->deviceInit) { ma_device_uninit(&impl_->device); impl_->deviceInit = false; }
  open_ = false; render_ = nullptr;
}

}  // namespace pg

#include "render/OfflineRenderer.hpp"
#include <algorithm>
#include <cmath>
#include "miniaudio.h"
#include "services/Transport.hpp"

namespace pg {

std::vector<float> renderInterleaved(Engine& engine, const RenderOptions& o) {
  // The same entry point the device callback uses, fed the same way: a chunk of `period` frames at a
  // time and a Transport the engine ticks once per block inside. There is deliberately no second path
  // here. When the offline render called `renderBlock` itself it was clean while the device path replayed
  // time once per block, and nothing could tell the two apart until someone listened.
  const uint32_t period = o.period == 0 ? engine.config().blockSize : o.period;
  const uint64_t total = static_cast<uint64_t>(std::llround(o.seconds * engine.config().sampleRate));
  std::vector<float> out(static_cast<size_t>(total) * o.channels);
  std::vector<float> stereo(static_cast<size_t>(period) * kMaxChannelsOut);
  Transport transport;
  transport.prepare(engine.config().sampleRate);
  transport.setTempo(o.transport.tempo);
  transport.setTimeSignature(o.transport.timeSigNumerator, o.transport.timeSigDenominator);
  transport.setScale(o.transport.scaleRoot, o.transport.scaleMask);
  transport.play();
  for (uint64_t pos = 0; pos < total; pos += period) {
    const uint32_t n = static_cast<uint32_t>(std::min<uint64_t>(period, total - pos));
    engine.renderInterleaved(stereo.data(), n, kMaxChannelsOut, transport);
    for (uint32_t i = 0; i < n; ++i)
      for (uint32_t c = 0; c < o.channels; ++c)
        out[(pos + i) * o.channels + c] = stereo[static_cast<size_t>(i) * kMaxChannelsOut + (c < 2 ? c : 1)];
  }
  return out;
}

bool writeWav(const std::string& path, const std::vector<float>& interleaved, uint32_t channels, double sampleRate, std::string& error) {
  ma_encoder_config cfg = ma_encoder_config_init(ma_encoding_format_wav, ma_format_f32, channels, static_cast<ma_uint32>(sampleRate));
  ma_encoder enc;
  if (ma_encoder_init_file(path.c_str(), &cfg, &enc) != MA_SUCCESS) { error = "cannot create " + path; return false; }
  ma_uint64 written = 0;
  const ma_uint64 frames = interleaved.size() / channels;
  const ma_result r = ma_encoder_write_pcm_frames(&enc, interleaved.data(), frames, &written);
  ma_encoder_uninit(&enc);
  if (r != MA_SUCCESS || written != frames) { error = "short write to " + path; return false; }
  return true;
}

}  // namespace pg

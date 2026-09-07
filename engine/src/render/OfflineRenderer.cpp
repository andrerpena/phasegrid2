#include "render/OfflineRenderer.hpp"
#include <algorithm>
#include <cmath>
#include "miniaudio.h"

namespace pg {

std::vector<float> renderInterleaved(Engine& engine, const RenderOptions& o) {
  const uint32_t block = engine.config().blockSize;
  const uint64_t total = static_cast<uint64_t>(std::llround(o.seconds * engine.config().sampleRate));
  std::vector<float> out(static_cast<size_t>(total) * o.channels);
  std::vector<float> l(block), r(block);
  float* planar[2] = {l.data(), r.data()};
  TransportSnapshot t;
  for (uint64_t pos = 0; pos < total; pos += block) {
    const uint32_t n = static_cast<uint32_t>(std::min<uint64_t>(block, total - pos));
    t.samplePos = pos;
    engine.renderBlock(planar, 2, n, t);
    for (uint32_t i = 0; i < n; ++i)
      for (uint32_t c = 0; c < o.channels; ++c) out[(pos + i) * o.channels + c] = planar[c < 2 ? c : 1][i];
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

#include "vital/SampleBank.hpp"
#include <vector>
#include "miniaudio.h"

namespace pg::vendor {

Result SampleBank::loadWav(const std::string& path, vital::Sample& into) {
  // Native channel count and rate: the sample keeps its own rate and the player retunes for it, so
  // resampling here would only add a generation of loss.
  ma_decoder_config config = ma_decoder_config_init(ma_format_f32, 0, 0);
  ma_decoder decoder;
  if (ma_decoder_init_file(path.c_str(), &config, &decoder) != MA_SUCCESS)
    return Result::fail("E_IO", "cannot decode " + path);

  const uint32_t channels = decoder.outputChannels;
  const uint32_t rate = decoder.outputSampleRate;
  if (channels != 1 && channels != 2) {
    ma_decoder_uninit(&decoder);
    return Result::fail("E_FORMAT", path + ": " + std::to_string(channels) + " channels, expected 1 or 2");
  }

  // Read in chunks rather than trusting a length query: not every decoder can report one up front, and a
  // file that lies about its length would otherwise leave the tail of the buffer uninitialised.
  constexpr ma_uint64 kChunk = 4096;
  std::vector<float> interleaved;
  std::vector<float> chunk(static_cast<size_t>(kChunk) * channels);
  ma_uint64 frames = 0;
  ma_result status = MA_SUCCESS;
  while (frames < static_cast<ma_uint64>(kMaxFrames)) {
    ma_uint64 read = 0;
    status = ma_decoder_read_pcm_frames(&decoder, chunk.data(), kChunk, &read);
    if (read == 0) break;
    interleaved.insert(interleaved.end(), chunk.begin(),
                       chunk.begin() + static_cast<ptrdiff_t>(read * channels));
    frames += read;
    if (status != MA_SUCCESS) break;   // MA_AT_END arrives with the last partial chunk
  }
  ma_decoder_uninit(&decoder);
  if (status != MA_SUCCESS && status != MA_AT_END) return Result::fail("E_IO", "read failed on " + path);
  if (frames == 0) return Result::fail("E_FORMAT", path + ": no audio frames");

  const int length = static_cast<int>(frames);
  if (channels == 1) {
    into.loadSample(interleaved.data(), length, static_cast<int>(rate));
  } else {
    std::vector<float> left(static_cast<size_t>(length)), right(static_cast<size_t>(length));
    for (size_t i = 0; i < static_cast<size_t>(length); ++i) {
      left[i] = interleaved[i * 2];
      right[i] = interleaved[i * 2 + 1];
    }
    into.loadSample(left.data(), right.data(), length, static_cast<int>(rate));
  }
  // The vendored default name is the built-in noise's; leaving it in place after a load would make every
  // loaded sample claim to be that.
  const size_t slash = path.find_last_of("/\\");
  into.setName(slash == std::string::npos ? path : path.substr(slash + 1));
  into.setLastBrowsedFile(path);
  return {};
}

}  // namespace pg::vendor

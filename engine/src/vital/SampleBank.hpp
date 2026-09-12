#pragma once
#include <string>
#include "core/Result.hpp"
#include "sample_source.h"

namespace pg::vendor {

/// Reads audio files into the vendored `Sample` a sampler module plays.
///
/// MESSAGE THREAD ONLY. Decoding allocates, and `Sample::loadSample` builds the whole band-limited pyramid
/// and then SPINS until the audio thread has released the previous data (`markUnused()`), so calling this
/// from `process()` would both allocate and block. The audio thread only ever reaches a sample through the
/// `markUsed()`/`markUnused()` handshake the vendored sample source performs for itself, which is what makes
/// swapping the content under a running player safe without a lock of ours.
class SampleBank {
public:
  /// Frames beyond this are dropped. The vendored mono loader applies the same cap internally; applying it
  /// here too keeps the stereo path (which has no cap of its own) from being handed an unbounded file.
  static constexpr int kMaxFrames = 1764000;   // 40 s at 44.1 kHz

  /// Decodes `path` (any format miniaudio can read) into `into`, replacing whatever it held.
  /// Fails with E_IO when the file cannot be opened or read, E_FORMAT when it is not one or two channels.
  static Result loadWav(const std::string& path, vital::Sample& into);
};

}  // namespace pg::vendor

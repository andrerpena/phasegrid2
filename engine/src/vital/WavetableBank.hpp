#pragma once
#include <cstdint>
#include <nlohmann/json.hpp>
#include <string>
#include "core/Result.hpp"
#include "wavetable.h"

namespace pg::vendor {

/// The wavetables an oscillator can be built on: a small set of built-in shapes rendered from the vendored
/// predefined wave frames, plus the vendored authoring format read back from JSON.
///
/// MESSAGE THREAD ONLY. Every entry point here allocates (a render resizes the table's frame storage) and
/// `vital::Wavetable::setNumFrames` spins until the audio thread has released the old frames, so calling any
/// of this from `process()` would both allocate and block. The audio thread only ever reads a table through
/// the vendored `markUsed()`/`markUnused()` handshake that `SynthOscillator::process` performs for itself,
/// which is what makes swapping a table under a running oscillator safe without a lock of ours.
class WavetableBank {
public:
  static uint32_t numBuiltins();
  static const char* builtinName(uint32_t index);
  /// Renders built-in `index` into `table`, replacing whatever it held. Out-of-range indices render 0.
  static void renderBuiltin(uint32_t index, vital::Wavetable& table);
  /// Loads a wavetable JSON document (the vendored authoring format, or a bare line-generator document).
  static Result loadJson(const nlohmann::json& document, vital::Wavetable& table);
  static Result loadFile(const std::string& path, vital::Wavetable& table);
};

}  // namespace pg::vendor

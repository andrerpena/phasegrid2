#pragma once
#include <string>
#include <vector>
#include "core/Engine.hpp"
namespace pg {
/// A render is a performance, so it needs a transport to perform under. Rendering a patch at 120 with
/// nothing rolling when the instrument is playing at 90 measures a different piece of music: note
/// lengths, gaps and anything reading the project's scale all move. `patch.render` seeds these from the
/// engine's own transport; the defaults are what a bare `--render` gets.
struct RenderOptions {
  double seconds = 1.0;
  uint32_t channels = 2;
  TransportSnapshot transport{};   // tempo, meter and scale; `playing` and the clocks are the renderer's
  /// Frames per call into the engine: the device period this render pretends to have. 0 is the engine's
  /// own block size. The sound must not depend on it, and a test says so; `--period 512` is how a render
  /// is made to take exactly the path a device callback takes.
  uint32_t period = 0;
};
std::vector<float> renderInterleaved(Engine& engine, const RenderOptions& options);
bool writeWav(const std::string& path, const std::vector<float>& interleaved, uint32_t channels, double sampleRate, std::string& error);
}

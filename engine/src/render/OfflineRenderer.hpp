#pragma once
#include <string>
#include <vector>
#include "core/Engine.hpp"
namespace pg {
struct RenderOptions { double seconds = 1.0; uint32_t channels = 2; };
std::vector<float> renderInterleaved(Engine& engine, const RenderOptions& options);
bool writeWav(const std::string& path, const std::vector<float>& interleaved, uint32_t channels, double sampleRate, std::string& error);
}

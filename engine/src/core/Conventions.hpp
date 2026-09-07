#pragma once
#include <cmath>
#include <cstdint>
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wconversion"
#include "common.h"        // vital: kMaxBufferSize, mono_float, poly_values.h
#include "futils.h"        // vital fast math with poly_float overloads
#pragma clang diagnostic pop

namespace pg {

using Sample = vital::poly_float;
using Mask = vital::poly_mask;

inline constexpr uint32_t kMaxBlockSize = static_cast<uint32_t>(vital::kMaxBufferSize);   // 128
inline constexpr uint32_t kDefaultBlockSize = 64;
inline constexpr uint32_t kMaxEventsPerBlock = 256;
inline constexpr uint32_t kMaxPortsPerModule = 32;
inline constexpr uint32_t kMaxParamsPerModule = 64;
static_assert(vital::poly_float::kSize == 4, "phasegrid2 assumes 4 SIMD lanes: v0.L v0.R v1.L v1.R");

inline constexpr float kOctavesPerUnit = 10.f;
inline constexpr float kMiddleCHz = 261.6256f;
inline constexpr float kMiddleCMidi = 60.f;

inline float pitchToHz(float v) { return kMiddleCHz * std::exp2(v * kOctavesPerUnit); }
inline float hzToPitch(float hz) { return std::log2(hz / kMiddleCHz) / kOctavesPerUnit; }
inline float midiNoteToPitch(float note) { return (note - kMiddleCMidi) / (12.f * kOctavesPerUnit); }
inline float pitchToMidiNote(float v) { return kMiddleCMidi + v * 12.f * kOctavesPerUnit; }
inline Sample midiNoteToPitch(Sample note) { return (note - kMiddleCMidi) * (1.f / (12.f * kOctavesPerUnit)); }
inline Sample pitchToMidiNote(Sample v) { return v * (12.f * kOctavesPerUnit) + kMiddleCMidi; }
inline bool gateHigh(float v) { return v > 0.f; }

}  // namespace pg

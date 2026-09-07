#pragma once
// Constants-only stand-in for Vital's VoiceHandler, enough for synth_parameters.cpp. The real voice handler
// is not vendored: phasegrid2 has its own voice allocation.
#include "synth_constants.h"
namespace vital {
class VoiceHandler {
public:
  enum VoicePriority { kNewest, kOldest, kHighest, kLowest, kRoundRobin, kNumVoicePriorities };
  enum VoiceOverride { kKill, kSteal, kNumVoiceOverrides };
};
}  // namespace vital

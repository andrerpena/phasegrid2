#pragma once
/// How long one cycle lasts, in musical time -- shared by every module that divides the transport.
///
/// `phase.clock` and `notes.pattern` both ask the question and must not answer it differently: a
/// pattern set to one bar and a clock set to one bar have to line up, in 6/8 as well as in 4/4.
#include <cstddef>

#include "core/Module.hpp"

namespace pg::modules {

inline const char* const kDivisionLabels[] = {"1/16", "1/8", "1/4", "1/2", "1 bar", "2 bars", "4 bars"};

/// The first four are absolute note values in quarter notes; the last three are counted in BARS, so
/// they follow the project's time signature -- 4/4 makes a bar four quarters, 6/8 makes it three.
inline constexpr double kQuartersPerCycle[] = {0.25, 0.5, 1.0, 2.0, 0.0, 0.0, 0.0};
inline constexpr double kBarsPerCycle[] = {0.0, 0.0, 0.0, 0.0, 1.0, 2.0, 4.0};
static_assert(std::size(kQuartersPerCycle) == std::size(kDivisionLabels));
static_assert(std::size(kBarsPerCycle) == std::size(kDivisionLabels));

inline constexpr uint32_t kDivisionCount = static_cast<uint32_t>(std::size(kQuartersPerCycle));

/// Quarter notes in one cycle at the given division, for this transport's time signature.
inline double quartersPerCycle(uint32_t division, const TransportSnapshot& t) {
  const size_t index = division < kDivisionCount ? division : 0;
  return kBarsPerCycle[index] > 0.0 ? kBarsPerCycle[index] * t.quartersPerBar()
                                    : kQuartersPerCycle[index];
}

}  // namespace pg::modules

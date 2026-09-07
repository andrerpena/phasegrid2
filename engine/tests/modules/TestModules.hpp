#pragma once
#include "core/Registry.hpp"
namespace pg::test {
/// Registers test.const, test.stereo, test.gain, test.add, test.impulse, test.sink, test.eventGen, test.eventTrace.
void registerTestModules(Registry& registry);
}

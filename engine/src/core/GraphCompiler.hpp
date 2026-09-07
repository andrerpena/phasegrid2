#pragma once
#include <memory>
#include <string>
#include "core/GraphModel.hpp"
#include "core/InstanceTable.hpp"
#include "core/Program.hpp"

namespace pg {
struct CompileOutput {
  std::unique_ptr<Program> program;   // null on error
  std::string error;                  // "E_CODE: message"
};
/// Message thread. Allocates everything the audio thread will need.
CompileOutput compileGraph(const GraphModel& model, const Registry& registry, InstanceTable& instances,
                           uint64_t revision, double sampleRate, uint32_t blockSize);
}  // namespace pg

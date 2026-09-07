#pragma once
#include <algorithm>
#include <array>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>
#include "core/Conventions.hpp"
#include "core/Event.hpp"
#include "core/GraphModel.hpp"
#include "core/Module.hpp"
#include "core/Param.hpp"
#include "core/Registry.hpp"
#include "core/Signal.hpp"

namespace pg {

inline constexpr uint32_t kNone = UINT32_MAX;
inline constexpr uint32_t kSilentBuffer = 0;   // buffers[0] is never written
inline constexpr uint32_t kEmptyEvents = 0;    // eventBufs[0] is never written

/// One per module id in the patch. Owned by InstanceTable, shared with every Program that uses it.
struct ModuleInstance {
  std::string id;
  uint64_t serial = 0;
  const RegisteredModule* type = nullptr;
  std::unique_ptr<Module> module;
  std::vector<ParamState> params;
  /// Display-unit value of every param at creation time (missing model params recorded as the default).
  /// `InstanceTable::acquire` compares the kParamStructural entries to decide whether it may reuse this instance.
  std::vector<float> structuralValues;
};

/// Delay memory for one back edge: z[i] holds the last written frame(s).
struct FeedbackState {
  std::array<Sample, kMaxBlockSize> z{};
};

struct Op {
  enum Kind : uint8_t { Sum, Merge, FillParam, FeedbackRead, FeedbackWrite, ClearEvents, Process, ClusterBegin, ClusterEnd };
  Kind kind;
  uint32_t a = 0, b = 0, c = 0;
};

struct NodeSlot {
  std::shared_ptr<ModuleInstance> inst;
  std::vector<uint32_t> inBuf;     // per declared input: buffer (kSilentBuffer if unconnected, kNone for event ports)
  std::vector<uint32_t> outBuf;    // per output: buffer (kNone for event ports)
  std::vector<uint32_t> inEvt;     // per declared input: event buffer (kNone for continuous ports)
  std::vector<uint32_t> outEvt;    // per output: event buffer (kNone for continuous ports)
  std::vector<uint32_t> paramBuf;  // per param: buffer with lane-wise per-sample values when modulated, else kNone
};

/// Immutable once published. Built on the message thread, executed on the audio thread.
struct Program {
  uint64_t revision = 0;
  uint32_t voiceCount = 1;
  uint32_t voicePairs = 1;
  std::vector<Mask> activeVoiceMask;   // one per pair; lanes of voices that exist
  uint32_t blockSize = kDefaultBlockSize;
  double sampleRate = 48000.0;
  FeedbackMode feedbackMode = FeedbackMode::Sample;

  std::vector<NodeSlot> nodes;
  std::vector<Block> buffers;
  std::vector<EventBuffer> eventBufs;
  std::vector<uint32_t> args;       // operand lists for Sum/Merge
  std::vector<Op> ops;
  std::vector<std::shared_ptr<FeedbackState>> feedback;
  std::vector<std::pair<uint64_t, uint32_t>> serialIndex;   // sorted (serial, node index)

  uint32_t allocBuffer() { buffers.emplace_back(); return static_cast<uint32_t>(buffers.size() - 1); }
  uint32_t allocEventBuffer() { eventBufs.emplace_back(); return static_cast<uint32_t>(eventBufs.size() - 1); }
  void buildSerialIndex() {
    serialIndex.clear();
    for (uint32_t i = 0; i < nodes.size(); ++i) serialIndex.emplace_back(nodes[i].inst->serial, i);
    std::sort(serialIndex.begin(), serialIndex.end());
  }
  int32_t findNodeBySerial(uint64_t serial) const {
    auto it = std::lower_bound(serialIndex.begin(), serialIndex.end(), std::make_pair(serial, uint32_t{0}));
    return (it != serialIndex.end() && it->first == serial) ? static_cast<int32_t>(it->second) : -1;
  }
  static Mask voiceMaskFor(uint32_t voiceCount, uint32_t pair) {
    const uint32_t first = pair * 2;
    const bool v0 = first < voiceCount, v1 = first + 1 < voiceCount;
    return Mask(v0 ? -1 : 0, v0 ? -1 : 0, v1 ? -1 : 0, v1 ? -1 : 0);
  }
};

}  // namespace pg

#pragma once
#include <algorithm>
#include <atomic>
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
#include "core/Voices.hpp"

namespace pg {

inline constexpr uint32_t kNone = UINT32_MAX;
inline constexpr uint32_t kSilentBuffer = 0;   // buffers[0] is never written
inline constexpr uint32_t kEmptyEvents = 0;    // eventBufs[0] is never written

/// One per module id in the patch. Owned by InstanceTable, shared with every Program that uses it.
static_assert(std::atomic<float>::is_always_lock_free, "the audio thread stores live values without a lock");

struct ModuleInstance {
  std::string id;
  /// Which telemetry slot this module publishes into on each channel, or `kNoTelemetrySlotCtx` for a
  /// channel nobody watches. Written by the message thread on subscribe, read by the audio thread every
  /// block, so they are atomic; they live here rather than in `Program` because a subscription must
  /// outlive a recompile and must not cause one. One per channel and never shared: a module that draws
  /// itself and has modulated knobs writes both, and one slot could only carry one of them.
  std::array<std::atomic<uint32_t>, kTelemetryChannelCount> slots;
  uint32_t slot(TelemetryChannel c) const {
    return slots[channelIndex(c)].load(std::memory_order_relaxed);
  }
  void setSlot(TelemetryChannel c, uint32_t slot) {
    slots[channelIndex(c)].store(slot, std::memory_order_relaxed);
  }
  /// Atomics do not aggregate-initialise, so the array is filled here rather than in its declaration.
  /// Message thread, once, when the instance is built.
  ModuleInstance() {
    for (auto& s : slots) s.store(kNoTelemetrySlotCtx, std::memory_order_relaxed);
  }
  /**
   * The effective value of every param at the last frame of the last block the module ran, voice 0,
   * in display units: what the module actually used, after modulation. Written by the scheduler
   * whenever anyone is watching (any slot set), read by the message thread to draw a picture from
   * the values the sound is made with. Relaxed atomics: a picture torn across two blocks is a picture.
   * `liveBlock` is the block they came from, 0 until the module has run under a subscription.
   */
  std::array<std::atomic<float>, kMaxParamsPerModule> liveValues{};
  std::atomic<uint64_t> liveBlock{0};
  uint64_t serial = 0;
  const RegisteredModule* type = nullptr;
  std::unique_ptr<Module> module;
  std::vector<ParamState> params;
  /// Display-unit value of every param as last handed to this instance, missing model params recorded as
  /// the default. Message thread only. Two readers: `InstanceTable::acquire` compares the kParamStructural
  /// entries to decide whether it may reuse the instance, and `Engine::commit` compares the rest against the
  /// model to find values that arrived by a route other than `Engine::setParam` and push them through the
  /// param queue. It is what keeps the model from getting ahead of the engine.
  std::vector<float> appliedValues;
  /// `NodeModel::data` at creation time, compared the same way and for the same reason.
  NodeData nodeData = NodeData::object();
  /// What the instance was prepared for. Compared by `InstanceTable::acquire`: a node whose voice
  /// count moved (it joined, left or resized an instrument) is rebuilt, and only that node.
  PrepareInfo info{};
};

/// Delay memory for one back edge, one slot per voice PAIR: `z[pair].data[i]` holds the last written
/// frame(s) for that pair. Pairs share the program's signal buffers -- they run the same op list one after
/// another -- but they must not share delay memory, or pair 0's delayed sample becomes pair 1's input and
/// the voices bleed into each other. Sized once, on the message thread, by `InstanceTable::acquireFeedback`;
/// a change of voice count produces a fresh state rather than resizing one the audio thread may be reading.
struct FeedbackState {
  explicit FeedbackState(uint32_t voicePairs) : z(voicePairs) {}
  std::vector<Block> z;
};

struct Op {
  /// `Allocate` runs an instrument entry's `Module::allocate` once, at the head of the instrument's
  /// segment, before its voice passes; `a` is the node.
  enum Kind : uint8_t { Sum, Merge, FillParam, FeedbackRead, FeedbackWrite, ClearEvents, Process, ClusterBegin, ClusterEnd, Allocate };
  Kind kind;
  uint32_t a = 0, b = 0, c = 0;
};

/// One instrument of the program: its entry node, the pool it runs on, and every node inside it.
struct Instrument {
  uint32_t entryNode = 0;
  uint32_t voices = 1;
  uint32_t pairs = 1;
  std::shared_ptr<VoiceActivity> activity;
  std::vector<uint32_t> nodes;   // every node of the instrument, the entry included
};

/// A run of ops that share a domain. A global segment runs once; an instrument segment runs its ops once
/// per live voice pair. An instrument's ops are always one contiguous segment, because the pairs share
/// the program's buffers and a pass has to see the whole instrument's work for its own pair.
struct Segment {
  int32_t instrument = -1;   // -1: global
  size_t firstOp = 0;
  size_t count = 0;
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
  uint32_t blockSize = kDefaultBlockSize;
  double sampleRate = 48000.0;
  FeedbackMode feedbackMode = FeedbackMode::Sample;

  std::vector<NodeSlot> nodes;
  std::vector<Block> buffers;
  std::vector<EventBuffer> eventBufs;
  std::vector<uint32_t> args;       // operand lists for Sum/Merge
  std::vector<Op> ops;
  /// The ops in segments, in order. Empty means the whole op list is one global segment, which is what
  /// a hand-built program in a test is.
  std::vector<Segment> segments;
  std::vector<Instrument> instruments;
  /// Per node: the instrument it belongs to, or -1 for a global node.
  std::vector<int32_t> nodeInstrument;
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
  /// Audio thread, at the swap that makes this program current: every instance that replaced one of
  /// `previous`'s -- same node id, same type, a different instance -- is handed the retiring one to
  /// `Module::adopt` from. Matched by id here, against the program that actually ran, rather than
  /// recorded at compile time: two compiles can land before one swap, and the instance the second one
  /// replaced never ran a block. Copies only, no allocation; a retried swap runs it again, which `adopt`
  /// is written for. Quadratic in the node count, paid once per swap, which is once per edit.
  void adoptFrom(const Program& previous) const {
    for (const NodeSlot& slot : nodes) {
      for (const NodeSlot& old : previous.nodes) {
        if (old.inst->id != slot.inst->id) continue;
        if (old.inst != slot.inst && old.inst->type == slot.inst->type) slot.inst->module->adopt(*old.inst->module);
        break;
      }
    }
  }
  /// The lanes a global signal lives in: voice 0's. A global module runs once and its output's second
  /// half mirrors its first, so a per-voice reader takes either half and a global one takes this.
  static Mask globalMask() { return Mask(-1, -1, 0, 0); }
};

}  // namespace pg

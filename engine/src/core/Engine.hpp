#pragma once
#include <array>
#include <atomic>
#include <memory>
#include <readerwriterqueue.h>
#include "core/GraphModel.hpp"
#include "core/InstanceTable.hpp"
#include "core/Program.hpp"
#include "core/Scheduler.hpp"
#include "rt/RtAssert.hpp"
#include "services/BlockSplitter.hpp"

namespace pg {

class TelemetryWriter;

inline constexpr uint32_t kMaxChannelsOut = 2;

struct EngineConfig {
  double sampleRate = 48000.0;
  uint32_t blockSize = kDefaultBlockSize;
};

struct ParamChange { uint64_t serial; uint32_t param; float norm; };

/// Owns the document mirror, compiles Programs, and hands them to the audio thread.
class Engine {
public:
  Engine(Registry& registry, EngineConfig config);
  ~Engine();

  // ---- message thread
  GraphModel& model() { return model_; }
  const EngineConfig& config() const { return config_; }
  Result commit();
  Result setParam(const std::string& node, const std::string& param, float value);
  void collectGarbage();
  uint64_t revision() const { return revision_; }
  size_t retiredCount() const { return retired_.size_approx(); }

  // ---- audio thread
  /**
   * The master output level, applied after everything else.
   *
   * A patch is a modular: an oscillator wired to the output drones whether or not the transport is
   * rolling, because nothing gates it. That is correct, and it leaves no way to make it stop. This is
   * that way — the panic control every modular environment needs. Message thread writes, audio thread
   * reads, so it is atomic.
   */
  void setOutputGain(float gain) noexcept { outputGain_.store(gain, std::memory_order_relaxed); }
  float outputGain() const noexcept { return outputGain_.load(std::memory_order_relaxed); }

  void setTelemetry(TelemetryWriter* t) { telemetry_ = t; }
  TelemetryWriter* telemetry() const { return telemetry_; }
  /// Message thread. Points a module at a slot, or `kNoTelemetrySlot` to stop it publishing.
  bool setTelemetrySlot(const std::string& node, uint32_t slot);
  void clearTelemetrySlots() { instances_.clearTelemetrySlots(); }
  bool hasInstance(const std::string& node) const { return instances_.find(node) != nullptr; }

  void renderBlock(float* const* out, uint32_t channels, uint32_t numFrames, const TransportSnapshot& t) noexcept PG_RT_NONBLOCKING;
  void renderInterleaved(float* out, uint32_t frames, uint32_t channels, const TransportSnapshot& t) noexcept PG_RT_NONBLOCKING;

private:
  void reconcileParams();
  void swapIfPending();
  void drainParams();

  Registry& registry_;
  EngineConfig config_;
  GraphModel model_;
  InstanceTable instances_;
  Scheduler scheduler_;
  /// Not owned. Set once by whoever built the segment, before rendering starts, and read by the audio
  /// thread thereafter; a null writer simply means telemetry is off and every display module is a no-op.
  TelemetryWriter* telemetry_ = nullptr;
  std::atomic<float> outputGain_{1.f};
  uint64_t revision_ = 0;

  std::unique_ptr<Program> initial_;
  Program* current_ = nullptr;
  Program* deferred_ = nullptr;   // audio thread only: a swap taken from pending_ but not yet retired
  std::atomic<Program*> pending_{nullptr};
  moodycamel::ReaderWriterQueue<Program*> retired_{256};
  moodycamel::ReaderWriterQueue<ParamChange> params_{4096};

  Block bus_;
  BlockSplitter splitter_;
  BlockSplitter::BlockFn splitterFn_;              // built once in the constructor (no std::function on the audio thread)
  std::array<float, kMaxBlockSize> scratchL_{}, scratchR_{};
  uint32_t interleavedChannels_ = 2;
  const TransportSnapshot* interleavedTransport_ = nullptr;
};

}  // namespace pg

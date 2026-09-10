#pragma once
#include <array>
#include <atomic>
#include <map>
#include <memory>
#include <utility>
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
  /// One cycle of `node`'s waveform at the model's current values, or an error when there is no such node
  /// or it has no picture to give. See `Module::preview`.
  Result preview(const std::string& node, float* out, uint32_t count);
  void collectGarbage();
  uint64_t revision() const { return revision_; }
  /// Which instrument each node of the last compiled program belongs to: the entry node's id, or an
  /// empty string for a global node. Message thread; what a client draws per-voice cables from.
  const std::map<std::string, std::string>& domains() const { return domains_; }
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

  /**
   * Whether the patch advances at all: Play and Stop, as against the master level above.
   *
   * A modular is not gated by its clock -- an oscillator wired to the output drones whether or not
   * the transport is rolling, and that is deliberate: `phase.clock` and `notes.clip` free-run off
   * `samplePos` so a patch keeps moving with nothing rolling, which is also what makes `--render`
   * audible. Silencing the output therefore hides a patch without stopping it, and everything a
   * running patch drives -- a modulated knob, the picture on a face -- goes on moving with nothing
   * to hear. That is what this stops. A held engine writes silence and runs no module, so every one
   * of them keeps the state it had and Play continues rather than restarts.
   *
   * It is NOT the transport's `playing`, and must not become it: an offline render has a stopped
   * transport and has to run. Message thread writes, audio thread reads.
   */
  void setRunning(bool running) noexcept { running_.store(running, std::memory_order_relaxed); }
  bool running() const noexcept { return running_.load(std::memory_order_relaxed); }

  void setTelemetry(TelemetryWriter* t) { telemetry_ = t; }
  TelemetryWriter* telemetry() const { return telemetry_; }
  /// Message thread. Points one channel of a module at a slot, or `kNoTelemetrySlotCtx` to stop it
  /// publishing there. The channels are independent: a module may hold a slot on each.
  bool setSlot(const std::string& node, TelemetryChannel channel, uint32_t slot);
  /// Message thread. Every module off every channel: `telemetry.subscribe` replaces the whole set.
  void clearSlots() { instances_.clearSlots(); }
  /// Every live instance, for the preview publisher. Message thread.
  template <class F>
  void forEachInstance(F&& f) { instances_.forEach(std::forward<F>(f)); }
  /// The model's values for `node` with the descriptor's defaults filled in, in descriptor order, or
  /// empty when there is no such node: what a module reads by name and never has to know which the
  /// document mentioned.
  ParamValues paramValuesFor(const std::string& node) const;
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
  /// True unless someone has held the patch. Default true, so a render, a tone and every test run.
  std::atomic<bool> running_{true};
  uint64_t revision_ = 0;
  std::map<std::string, std::string> domains_;

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

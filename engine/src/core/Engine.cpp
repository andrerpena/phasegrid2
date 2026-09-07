#include "core/Engine.hpp"
#include <algorithm>
#include <cassert>
#include "core/GraphCompiler.hpp"
#include "poly_utils.h"

namespace pg {

Engine::Engine(Registry& registry, EngineConfig config) : registry_(registry), config_(config) {
  config_.blockSize = std::min(config.blockSize, kMaxBlockSize);
  initial_ = std::make_unique<Program>();
  initial_->allocBuffer();
  initial_->allocEventBuffer();
  initial_->activeVoiceMask.push_back(Program::voiceMaskFor(1, 0));
  initial_->sampleRate = config_.sampleRate;
  initial_->blockSize = config_.blockSize;
  current_ = initial_.get();
  splitter_.prepare(config_.blockSize, kMaxChannelsOut);
  splitterFn_ = [this](float* block, uint32_t n) {
    float* planar[2] = {scratchL_.data(), scratchR_.data()};
    renderBlock(planar, 2, n, *interleavedTransport_);
    for (uint32_t i = 0; i < n; ++i)
      for (uint32_t c = 0; c < interleavedChannels_; ++c) block[i * interleavedChannels_ + c] = planar[c < 2 ? c : 1][i];
  };
}

Engine::~Engine() {
  collectGarbage();
  if (Program* p = pending_.exchange(nullptr)) delete p;
  delete deferred_;
  if (current_ != initial_.get()) delete current_;
}

Result Engine::commit() {
  collectGarbage();   // opportunistically drain whatever the last swap retired, success or failure
  CompileOutput out = compileGraph(model_, registry_, instances_, revision_ + 1, config_.sampleRate, config_.blockSize);
  if (!out.program) {
    // compileGraph formats failures as "CODE: message"; without the separator `npos + 2` would wrap.
    const auto colon = out.error.find(": ");
    if (colon == std::string::npos) return Result::fail("E_COMPILE", out.error);
    return Result::fail(out.error.substr(0, colon), out.error.substr(colon + 2));
  }
  ++revision_;
  if (Program* stale = pending_.exchange(out.program.release(), std::memory_order_acq_rel)) delete stale;
  reconcileParams();
  return {};
}

/**
 * Pushes model values that arrived by a route other than `setParam` into the instances that outlived
 * the compile.
 *
 * `patch.batch`, `patch.load` and `loadPatchJson` all write the model and commit, and a compile reuses
 * an instance whenever (id, type) and its structural values match. That instance still holds whatever
 * it was created with, so without this a knob turned through a batch changed the document and nothing
 * else, and opening a project over another one kept the old project's values on every node that shared
 * a name. Values go through the queue, never into `ParamState` directly: after `prepare` that belongs to
 * the audio thread. A full queue leaves the snapshot alone so the next commit tries again.
 */
void Engine::reconcileParams() {
  for (const auto& [id, node] : model_.nodes()) {
    ModuleInstance* inst = instances_.find(id);
    if (inst == nullptr || inst->type != registry_.find(node.type)) continue;
    const ModuleDescriptor& desc = *inst->type->desc;
    for (uint32_t i = 0; i < desc.numParams; ++i) {
      const ParamDesc& d = desc.params[i];
      if (d.flags & kParamStructural) continue;   // applied by rebuilding; `acquire` already compared it
      const auto pv = node.params.find(d.id);
      const float value = pv == node.params.end() ? d.def : pv->second;
      if (value == inst->appliedValues[i]) continue;
      if (params_.try_enqueue(ParamChange{inst->serial, i, paramNormalize(d, value)})) inst->appliedValues[i] = value;
    }
  }
}

/// Subscribing must not recompile: the assignment lives on the instance, which outlives every program.
bool Engine::setTelemetrySlot(const std::string& node, uint32_t slot) {
  const ModuleInstance* inst = instances_.find(node);
  if (inst == nullptr) return false;
  const_cast<ModuleInstance*>(inst)->telemetrySlot.store(slot, std::memory_order_relaxed);
  return true;
}

Result Engine::setParam(const std::string& node, const std::string& param, float value) {
  Result r = model_.setParam(registry_, node, param, value);
  if (!r) return r;
  const ModuleInstance* inst = instances_.find(node);
  if (!inst) return {};
  const RegisteredModule* modelType = registry_.find(model_.nodes().at(node).type);
  const int32_t idx = inst->type->findParam(param);
  if (inst->type != modelType || idx < 0) return {};   // instance predates a retype; the next commit rebuilds it
  const ParamDesc& d = inst->type->desc->params[idx];
  // A drop leaves the model ahead of the engine: the value is already in GraphModel but never
  // reaches ParamState, and nothing reconciles the two until a future patch-reload path exists
  // (see InstanceTable::acquire). The caller is expected to retry.
  if (!params_.try_enqueue(ParamChange{inst->serial, static_cast<uint32_t>(idx), paramNormalize(d, value)}))
    return Result::fail("E_QUEUE_FULL", "param queue full");
  // The snapshot follows the queue for an ordinary param. A structural one is deliberately left behind:
  // it is applied by `InstanceTable::acquire` building a fresh instance on the next commit, and acquire
  // decides that by finding the snapshot different from the model. Recording it here would tell acquire
  // there was nothing to do, and the old instance would play on with the old table.
  if (!(d.flags & kParamStructural))
    const_cast<ModuleInstance*>(inst)->appliedValues[static_cast<size_t>(idx)] = model_.nodes().at(node).params.at(param);
  return {};
}

Result Engine::preview(const std::string& node, float* out, uint32_t count) {
  const auto it = model_.nodes().find(node);
  if (it == model_.nodes().end()) return Result::fail("E_NODE_NOT_FOUND", "no module " + node);
  const ModuleInstance* inst = instances_.find(node);
  if (inst == nullptr) return Result::fail("E_NODE_NOT_FOUND", "module " + node + " is not built yet");
  if ((inst->type->desc->flags & kModulePreviewsWave) == 0)
    return Result::fail("E_UNSUPPORTED", "module " + node + " has no waveform to show");
  // The model's values with the descriptor's defaults filled in, so a module reads every param by name
  // and never has to know which ones the document happened to mention.
  ParamValues values;
  for (uint32_t i = 0; i < inst->type->desc->numParams; ++i) {
    const ParamDesc& d = inst->type->desc->params[i];
    const auto pv = it->second.params.find(d.id);
    values[d.id] = pv == it->second.params.end() ? d.def : pv->second;
  }
  if (!inst->module->preview(values, out, count))
    return Result::fail("E_UNSUPPORTED", "module " + node + " has no waveform to show");
  return {};
}

void Engine::collectGarbage() {
  Program* p = nullptr;
  while (retired_.try_dequeue(p)) if (p != initial_.get()) delete p;
}

void Engine::swapIfPending() {
  if (!deferred_) deferred_ = pending_.exchange(nullptr, std::memory_order_acq_rel);   // take at most one
  if (!deferred_) return;
  if (!retired_.try_enqueue(current_)) return;      // retire queue full: keep deferred_, retry next block
  current_ = deferred_;
  deferred_ = nullptr;
}

void Engine::drainParams() {
  ParamChange c;
  while (params_.try_dequeue(c)) {
    const int32_t node = current_->findNodeBySerial(c.serial);
    if (node < 0) continue;
    current_->nodes[static_cast<size_t>(node)].inst->params[c.param].setTargetNorm(c.norm);
  }
}

void Engine::renderBlock(float* const* out, uint32_t channels, uint32_t numFrames, const TransportSnapshot& t) noexcept {
  assert(numFrames <= kMaxBlockSize);
  numFrames = std::min(numFrames, kMaxBlockSize);
  swapIfPending();
  drainParams();
  for (uint32_t i = 0; i < numFrames; ++i) bus_.data[i] = Sample(0.f);
  AudioBus bus{bus_.data.data(), numFrames};
  scheduler_.run(*current_, numFrames, t, &bus, telemetry_);
  // Fold voice pairs: L = v0.L + v1.L, R = v0.R + v1.R. No mask here: the bus already holds the sum of
  // every pair, so there is no one mask that fits it. Terminal modules apply `ctx.voiceMask` as they add,
  // which is the only point at which the pair the lanes belong to is still known.
  // Read once per block rather than per frame: it changes at human speed, and a per-frame atomic load
  // in the innermost loop of the render is a cost paid a million times a second for nothing.
  const float gain = outputGain_.load(std::memory_order_relaxed);
  for (uint32_t i = 0; i < numFrames; ++i) {
    const Sample& summed = bus_.data[i];
    const Sample folded = summed + vital::utils::swapVoices(summed);   // lanes 0,1 now hold L,R sums
    if (channels > 0) out[0][i] = folded[0] * gain;
    if (channels > 1) out[1][i] = folded[1] * gain;
    for (uint32_t c = 2; c < channels; ++c) out[c][i] = folded[1] * gain;
  }
}

void Engine::renderInterleaved(float* out, uint32_t frames, uint32_t channels, const TransportSnapshot& t) noexcept {
  interleavedChannels_ = channels;
  interleavedTransport_ = &t;
  if (channels != kMaxChannelsOut) { std::fill_n(out, static_cast<size_t>(frames) * channels, 0.f); return; }   // other counts wired in phase 4
  splitter_.render(out, frames, splitterFn_);
}

}  // namespace pg

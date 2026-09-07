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
    const auto colon = out.error.find(':');
    return Result::fail(out.error.substr(0, colon), out.error.substr(colon + 2));
  }
  ++revision_;
  if (Program* stale = pending_.exchange(out.program.release(), std::memory_order_acq_rel)) delete stale;
  return {};
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
  if (!params_.try_enqueue(ParamChange{inst->serial, static_cast<uint32_t>(idx), paramNormalize(d, value)}))
    return Result::fail("E_QUEUE_FULL", "param queue full");
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
  scheduler_.run(*current_, numFrames, t, &bus);
  // Fold voice pairs: L = v0.L + v1.L, R = v0.R + v1.R, masked by the active voices (M1: one pair).
  const Mask mask = current_->activeVoiceMask.empty() ? Mask(-1) : current_->activeVoiceMask[0];
  for (uint32_t i = 0; i < numFrames; ++i) {
    const Sample masked = bus_.data[i] & mask;
    const Sample folded = masked + vital::utils::swapVoices(masked);   // lanes 0,1 now hold L,R sums
    if (channels > 0) out[0][i] = folded[0];
    if (channels > 1) out[1][i] = folded[1];
    for (uint32_t c = 2; c < channels; ++c) out[c][i] = folded[1];
  }
}

void Engine::renderInterleaved(float* out, uint32_t frames, uint32_t channels, const TransportSnapshot& t) noexcept {
  interleavedChannels_ = channels;
  interleavedTransport_ = &t;
  if (channels != kMaxChannelsOut) { std::fill_n(out, static_cast<size_t>(frames) * channels, 0.f); return; }   // other counts wired in phase 4
  splitter_.render(out, frames, splitterFn_);
}

}  // namespace pg

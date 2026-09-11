#include "sst/WrappedEffect.hpp"
#include <algorithm>
#include <cmath>
#include <stdexcept>
#include "core/Registry.hpp"

namespace pg::sstfx {

Module* WrappedEffect::createFromRegistry() {
  if (!g_creatingDescriptor)
    throw std::runtime_error("sst effect created outside InstanceTable::acquire");
  return new WrappedEffect(*g_creatingDescriptor);
}

WrappedEffect::WrappedEffect(const ModuleDescriptor& desc) : desc_(desc), spec_(specFor(desc)) {}

float WrappedEffect::Native::operator()(float display) const {
  switch (kind) {
    case Kind::Linear: return (display - b) / a;
    // display = a * 2^(b * native + c)  ->  native = (log2(display / a) - c) / b
    case Kind::Pow2: return (std::log2(std::max(display, 1e-9f) / a) - c) / b;
    case Kind::Identity: break;
  }
  return display;
}

void WrappedEffect::prepare(const PrepareInfo& info) {
  sampleRate_ = info.sampleRate;
  pairs_.clear();
  fifos_.clear();
  const uint32_t count = (info.voiceCount + 1) / 2;
  for (uint32_t p = 0; p < count; ++p) {
    pairs_.push_back(std::unique_ptr<Instance>(spec_.create()));
    Instance& fx = *pairs_.back();
    fx.global().samplerate = info.sampleRate;
    fx.global().dsamplerate_inv = 1.0 / info.sampleRate;
    // A different seed per pair, so two instances of the same effect do not modulate in lockstep.
    fx.global().rng = 0x9E3779B9u + p * 0x85EBCA6Bu;
    fx.onSampleRateChanged();
    fx.initialize();
  }
  fifos_.assign(count, Fifo{});

  // The display-to-native mapping, read from the effect's own metadata so it cannot drift from what
  // `buildDescriptor` published. Mirrors `rangeOf` in Descriptors.cpp.
  native_.assign(desc_.numParams, Native{});
  slot_.assign(desc_.numParams, 0);
  if (!pairs_.empty()) {
    uint32_t ours = 0;
    for (int i = 0; i < pairs_[0]->numParams() && ours < desc_.numParams; ++i) {
      const ParamMeta meta = pairs_[0]->paramAt(i);
      if (!publishable(meta)) continue;
      slot_[ours] = i;
      Native& n = native_[ours];
      ++ours;
      if (meta.displayScale == ParamMeta::LINEAR) {
        n = {Native::Kind::Linear, meta.svA, meta.svB, 0.f};
      } else if (meta.displayScale == ParamMeta::A_TWO_TO_THE_B && meta.svD == 0.f && meta.svA > 0.f) {
        n = {Native::Kind::Pow2, meta.svA, meta.svB, meta.svC};
      }
    }
    // A parameter we do not publish still has to hold a sane value, or the effect reads whatever
    // zero happens to mean for it.
    for (auto& fx : pairs_) {
      for (int i = 0; i < fx->numParams() && i < kMaxEffectParams; ++i)
        fx->values().v[i] = fx->paramAt(i).defaultVal;
      fx->initialize();
    }
  }
}

void WrappedEffect::reset(uint32_t voicePair) {
  if (voicePair >= pairs_.size()) return;
  pairs_[voicePair]->initialize();
  fifos_[voicePair] = Fifo{};
}

/// Copies this block's knob values into the effect's value storage, in the effect's own units, and
/// refreshes what it knows about the world. Once per sst block, which is what the effects expect.
void WrappedEffect::refresh(ProcessContext& c, Instance& fx) {
  Values& v = fx.values();
  for (uint32_t i = 0; i < desc_.numParams && i < kMaxEffectParams; ++i)
    v.v[slot_[i]] = native_[i](lanes::lane(c.param(i).at(0), 0));
  if (c.transport != nullptr) fx.global().tempo = static_cast<float>(c.transport->tempo);
}

void WrappedEffect::runDirect(ProcessContext& c, Instance& fx, const Sample* in, Sample* out, uint32_t n) {
  float left[kSstBlock], right[kSstBlock];
  for (uint32_t base = 0; base < n; base += kSstBlock) {
    for (uint32_t i = 0; i < kSstBlock; ++i) {
      const Sample x = in[base + i];
      left[i] = x[0];
      right[i] = x[1];
    }
    refresh(c, fx);
    fx.processBlock(left, right);
    if (out != nullptr)
      for (uint32_t i = 0; i < kSstBlock; ++i) out[base + i] = Sample(left[i], right[i], left[i], right[i]);
  }
}

/**
 * The frame-at-a-time path: gather until there is a whole block, run it, hand it back a frame at a
 * time. One block of latency, and only a sample-accurate feedback cluster ever takes this path.
 */
void WrappedEffect::runBuffered(ProcessContext& c, Instance& fx, const Sample* in, Sample* out, uint32_t n) {
  Fifo& f = fifos_[c.voice];
  for (uint32_t i = 0; i < n; ++i) {
    const Sample x = in[i];
    f.inL[f.fill] = x[0];
    f.inR[f.fill] = x[1];
    ++f.fill;

    if (out != nullptr) {
      // Silence until the first block has been produced; after that, the block before this one.
      const float l = f.primed ? f.outL[f.drained] : 0.f;
      const float r = f.primed ? f.outR[f.drained] : 0.f;
      out[i] = Sample(l, r, l, r);
    }
    ++f.drained;

    if (f.fill == kSstBlock) {
      std::copy(f.inL.begin(), f.inL.end(), f.outL.begin());
      std::copy(f.inR.begin(), f.inR.end(), f.outR.begin());
      refresh(c, fx);
      fx.processBlock(f.outL.data(), f.outR.data());
      f.fill = 0;
      f.drained = 0;
      f.primed = true;
    }
  }
}

void WrappedEffect::process(ProcessContext& c) {
  if (c.voice >= pairs_.size()) return;   // a pair the module was never prepared for
  const uint32_t n = c.numFrames;
  if (n == 0) return;
  Instance& fx = *pairs_[c.voice];
  const Sample* in = c.in(0).readOr();
  Sample* out = c.out(0).data;

  // Direct only while nothing is held back, or the FIFO's frames would be dropped.
  if (fifos_[c.voice].fill == 0 && !fifos_[c.voice].primed && n % kSstBlock == 0)
    runDirect(c, fx, in, out, n);
  else
    runBuffered(c, fx, in, out, n);
}

}  // namespace pg::sstfx

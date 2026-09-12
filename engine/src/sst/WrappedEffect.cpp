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
  // One effect per voice. A global module has one voice and makes one; inside an instrument every
  // voice gets its own, because an sst effect is a mono-stereo processor and cannot carry two.
  voices_.clear();
  voices_.resize(info.voiceCount < 1 ? 1 : info.voiceCount);
  for (uint32_t v = 0; v < voices_.size(); ++v) {
    Voice& voice = voices_[v];
    voice.fx.reset(spec_.create());
    voice.fx->global().samplerate = info.sampleRate;
    voice.fx->global().dsamplerate_inv = 1.0 / info.sampleRate;
    // A different seed per voice, so two of them do not modulate in lockstep.
    voice.fx->global().rng = 0x9E3779B9u + v * 0x85EBCA6Bu;
    voice.fx->onSampleRateChanged();
  }
  forget_ = std::exp(-1.f / static_cast<float>(info.sampleRate));

  // The display-to-native mapping, read from the effect's own metadata so it cannot drift from what
  // `buildDescriptor` published. Mirrors `rangeOf` in Descriptors.cpp.
  native_.assign(desc_.numParams, Native{});
  slot_.assign(desc_.numParams, 0);
  Instance& probe = *voices_[0].fx;
  uint32_t ours = 0;
  for (int i = 0; i < probe.numParams() && ours < desc_.numParams; ++i) {
    const ParamMeta meta = probe.paramAt(i);
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
  // A parameter we do not publish still has to hold a sane value, or the effect reads whatever zero
  // happens to mean for it.
  for (Voice& voice : voices_) {
    for (int i = 0; i < voice.fx->numParams() && i < kMaxEffectParams; ++i)
      voice.fx->values().v[i] = voice.fx->paramAt(i).defaultVal;
    voice.fx->initialize();
  }
}

void WrappedEffect::reset(uint32_t voicePair) {
  for (uint32_t v = 2 * voicePair; v < 2 * voicePair + 2 && v < voices_.size(); ++v) {
    Voice& voice = voices_[v];
    voice.fx->initialize();
    voice.fill = 0;
    voice.drained = 0;
    voice.primed = false;
    voice.loudest = 0.f;
  }
}

/// Copies this block's knob values into the effect's value storage, in the effect's own units, and
/// refreshes what it knows about the world. Once per sst block, which is what the effects expect.
void WrappedEffect::refresh(ProcessContext& c, Instance& fx) {
  Values& v = fx.values();
  for (uint32_t i = 0; i < desc_.numParams && i < kMaxEffectParams; ++i)
    v.v[slot_[i]] = native_[i](lanes::lane(c.param(i).at(0), 0));
  if (c.transport != nullptr) fx.global().tempo = static_cast<float>(c.transport->tempo);
}

void WrappedEffect::runDirect(ProcessContext& c, Voice& v, uint32_t lane, const Sample* in, Sample* out,
                              uint32_t n) {
  alignas(16) float left[kSstBlock], right[kSstBlock];
  for (uint32_t base = 0; base < n; base += kSstBlock) {
    for (uint32_t i = 0; i < kSstBlock; ++i) {
      const Sample x = in[base + i];
      left[i] = x[lane];
      right[i] = x[lane + 1];
    }
    refresh(c, *v.fx);
    v.fx->processBlock(left, right);
    if (out != nullptr)
      for (uint32_t i = 0; i < kSstBlock; ++i) {
        Sample& s = out[base + i];
        s.set(lane, left[i]);
        s.set(lane + 1, right[i]);
      }
  }
}

/**
 * The frame-at-a-time path: gather until there is a whole block, run it, hand it back a frame at a
 * time. One block of latency, and only a sample-accurate feedback cluster ever takes this path.
 */
void WrappedEffect::runBuffered(ProcessContext& c, Voice& v, uint32_t lane, const Sample* in, Sample* out,
                                uint32_t n) {
  for (uint32_t i = 0; i < n; ++i) {
    const Sample x = in[i];
    v.inL[v.fill] = x[lane];
    v.inR[v.fill] = x[lane + 1];
    ++v.fill;

    if (out != nullptr) {
      // Silence until the first block has been produced; after that, the block before this one.
      Sample& s = out[i];
      s.set(lane, v.primed ? v.outL[v.drained] : 0.f);
      s.set(lane + 1, v.primed ? v.outR[v.drained] : 0.f);
    }
    ++v.drained;

    if (v.fill == kSstBlock) {
      std::copy(v.inL.begin(), v.inL.end(), v.outL.begin());
      std::copy(v.inR.begin(), v.inR.end(), v.outR.begin());
      refresh(c, *v.fx);
      v.fx->processBlock(v.outL.data(), v.outR.data());
      v.fill = 0;
      v.drained = 0;
      v.primed = true;
    }
  }
}

void WrappedEffect::process(ProcessContext& c) {
  const uint32_t n = c.numFrames;
  if (n == 0) return;
  const Sample* in = c.in(0).readOr();
  Sample* out = c.out(0).data;
  if (out != nullptr) for (uint32_t i = 0; i < n; ++i) out[i] = Sample(0.f);

  for (uint32_t half = 0; half < 2; ++half) {
    const uint32_t index = 2 * c.voice + half;
    const uint32_t lane = 2 * half;
    if (index >= voices_.size()) {
      // A global module has one voice, and the convention downstream is that its signal is mirrored
      // onto the second half of the register; `io.audioOut` masks the copy away again.
      if (out != nullptr && half == 1)
        for (uint32_t i = 0; i < n; ++i) {
          out[i].set(2, out[i][0]);
          out[i].set(3, out[i][1]);
        }
      break;
    }
    Voice& v = voices_[index];

    // Direct only while nothing is held back, or the FIFO's frames would be dropped.
    if (v.fill == 0 && !v.primed && n % kSstBlock == 0) runDirect(c, v, lane, in, out, n);
    else runBuffered(c, v, lane, in, out, n);

    /*
     * The voice-lifetime rule (docs/adrs/0002): while this effect is still RINGING OUT, the voice it
     * belongs to is still going. Without it a reverb placed inside an instrument -- an oscillator
     * straight into one, which is the first way anyone patches it -- is cut off the instant the note
     * ends and produces no reverb at all.
     *
     * The condition is the whole of the design, and neither obvious version of it works.
     *
     * Holding whenever the OUTPUT is audible latches: the effect keeps its own voice alive, the voice
     * goes on feeding it, and a patch with no envelope in it never releases a note again.
     *
     * Holding only once the INPUT is silent is too late. `VoiceActivity::settle` commits a voice to
     * its fade after ONE block with nothing holding it, and does not consult the holders again; by
     * the time an envelope's release has reached true silence, that block has already passed.
     *
     * So the test is whether the input is FALLING AWAY rather than whether it has arrived at zero:
     * quiet relative to how loud this voice has recently been. An envelope in its release passes that
     * while it still has a way to go, which is in time; an oscillator running flat out never does,
     * however long it runs, so nothing latches.
     */
    if (c.activity == nullptr || out == nullptr) continue;
    float dry = 0.f, wet = 0.f;
    for (uint32_t i = 0; i < n; ++i) {
      dry = std::max(dry, std::fabs(in[i][static_cast<int>(lane)]));
      wet = std::max(wet, std::fabs(out[i][static_cast<int>(lane)]));
    }
    v.loudest = std::max(dry, v.loudest * std::pow(forget_, static_cast<float>(n)));
    const bool stopped = dry <= std::max(v.loudest * kStopped, kSilence);
    if (stopped && wet > kSilence) c.activity->hold(index);
  }
}

}  // namespace pg::sstfx

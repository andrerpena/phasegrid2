#pragma once
#include <cmath>
#include <cstdint>
#include "core/Conventions.hpp"
#include "core/Param.hpp"

// The vendored SST headers are not ours to fix, and they instantiate inside our translation units;
// including them through the SYSTEM include path (see engine/cmake/Deps.cmake) keeps their
// diagnostics off our warning budget. `setup.h` must come first: it is what selects simde on arm64.
#include "sst/basic-blocks/simd/setup.h"
#include "sst/filters/BiquadFilter.h"

/**
 * The adapter that lets phasegrid host the Surge Synth Team effect library.
 *
 * `sst-effects` is a set of template classes, each taking a *configuration* type that answers the
 * handful of questions an effect has about its host: what the sample rate is, where its parameter
 * values live, how to turn a note into a pitch. Surge supplies `surge::sstfx::SurgeFXConfig`; this
 * is phasegrid's, and it is the whole of the coupling. The contract is documented in
 * `sst/effects/EffectCore.h`, and `sst/effects/ConcreteConfig.h` is the library's own minimal
 * reference implementation of it -- worth reading next to this file.
 *
 * Nothing here is specific to one effect. A concrete module is an `EffectSpec` value; see
 * `engine/src/sst/Descriptors.hpp` and the module files under `engine/src/modules/sst`.
 */
namespace pg::sstfx {

/// The most parameters any effect we host declares. `ConcreteConfig` uses 20; the largest in the
/// library today is well under that, and `buildDescriptor` refuses anything over it.
inline constexpr int kMaxEffectParams = 24;

/**
 * How many frames an effect processes at a time.
 *
 * The library requires a power of two of at least four, fixed at compile time. 32 divides our
 * ordinary 64-frame block exactly, so the common path runs the effect twice with no buffering and
 * no latency; `WrappedEffect` keeps a FIFO for the one case that does not divide -- a
 * sample-accurate feedback cluster, which the scheduler runs a frame at a time.
 */
inline constexpr uint16_t kSstBlock = 32;

/**
 * What the effects ask their host about the world.
 *
 * The snake_case members are not a slip: `sst::filters::Biquad::DefaultTuningAndDBAdapter` calls
 * them by those names, because it was written against Surge's own storage type.
 */
struct Global {
  double samplerate = 48000.0;
  double dsamplerate_inv = 1.0 / 48000.0;
  /// Beats per minute, for the tempo-synced controls. Refreshed from the transport each block.
  float tempo = 120.f;
  /// A per-instance generator, so two reverbs do not share a sequence and nothing reaches for
  /// `rand()` on the audio thread.
  uint32_t rng = 0x9E3779B9u;

  float note_to_pitch_ignoring_tuning(float n) const { return std::exp2(n * (1.f / 12.f)); }
  float db_to_linear(float db) const { return std::pow(10.f, db * 0.05f); }
};

/// Per-effect configuration the library can ask about -- whether a control is deactivated, extended
/// or tempo-synced. phasegrid has no such switches yet: a control that an effect would deactivate is
/// simply a control we publish and leave alone, so every answer here is a constant.
struct EffectState {};

/// Where an effect reads its parameter values. `WrappedEffect` refreshes this from the block's
/// `ParamView`s before each `processBlock`, so the effect sees plain floats and knows nothing about
/// smoothing, modulation or lanes.
struct Values {
  float v[kMaxEffectParams] = {};
};

/// The base class every effect inherits. The library only needs it to exist and to swallow the
/// constructor arguments; ours carries nothing, because the values live in `Values`.
struct EffectBase {
  template <typename... Ts> EffectBase(Ts...) {}
};

/// The configuration itself: the type the effect templates are instantiated with.
struct Config {
  static constexpr uint16_t blockSize{kSstBlock};

  using BaseClass = EffectBase;
  using GlobalStorage = Global;
  using EffectStorage = EffectState;
  using ValueStorage = Values;
  using BiquadAdapter = sst::filters::Biquad::DefaultTuningAndDBAdapter<GlobalStorage>;

  static inline float floatValueAt(const BaseClass*, const ValueStorage* v, int idx) {
    return v->v[idx];
  }
  /// No control of ours has an extended range, so this is the plain value.
  static inline float floatValueExtendedAt(const BaseClass* b, const ValueStorage* v, int idx) {
    return floatValueAt(b, v, idx);
  }
  static inline int intValueAt(const BaseClass*, const ValueStorage* v, int idx) {
    return static_cast<int>(std::lround(v->v[idx]));
  }

  /// The library's own definition (see `ConcreteConfig`): how far a one-pole moves in one block.
  static inline float envelopeRateLinear(GlobalStorage* s, float f) {
    return static_cast<float>(blockSize / s->samplerate) * std::pow(2.f, -f);
  }

  static inline bool temposyncInitialized(GlobalStorage*) { return true; }
  static inline bool isTemposynced(EffectStorage*, int) { return false; }
  static inline float temposyncRatio(GlobalStorage*, EffectStorage*, int) { return 1.f; }
  static inline float temposyncRatioInv(GlobalStorage*, EffectStorage*, int) { return 1.f; }
  static inline bool isDeactivated(EffectStorage*, int) { return false; }
  static inline bool isExtended(EffectStorage*, int) { return false; }
  static inline int deformType(EffectStorage*, int) { return 0; }

  /// xorshift32. On the audio thread, so it allocates nothing and takes no lock; the quality only
  /// has to be good enough to keep a modulator from repeating audibly.
  static inline float rand01(GlobalStorage* s) {
    uint32_t x = s->rng;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    s->rng = x;
    return static_cast<float>(x >> 8) * (1.f / 16777216.f);
  }

  static inline double sampleRate(GlobalStorage* s) { return s->samplerate; }
  static inline double sampleRateInv(GlobalStorage* s) { return s->dsamplerate_inv; }

  /// phasegrid has no alternate tuning, so both forms are the equal-tempered one.
  static inline float noteToPitch(GlobalStorage* s, float p) { return s->note_to_pitch_ignoring_tuning(p); }
  static inline float noteToPitchIgnoringTuning(GlobalStorage* s, float p) {
    return s->note_to_pitch_ignoring_tuning(p);
  }
  static inline float noteToPitchInv(GlobalStorage* s, float p) {
    return 1.f / s->note_to_pitch_ignoring_tuning(p);
  }
  static inline float dbToLinear(GlobalStorage* s, float db) { return s->db_to_linear(db); }
};

}  // namespace pg::sstfx

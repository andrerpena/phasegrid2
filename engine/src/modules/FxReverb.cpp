#include <algorithm>
#include <cmath>
#include <memory>
#include <vector>

#include "core/Module.hpp"
#include "futils.h"
#include "one_pole_filter.h"
#include "poly_utils.h"
#include "services/Telemetry.hpp"
#include "synth_constants.h"

namespace pg::modules {
namespace {

/**
 * `fx.reverb` -- the algorithmic reverb, modelled on the reference instrument's.
 *
 * An Early section (a diffused set of reflections whose Mode and Size say what room it is), a Late
 * tank (a feedback delay network whose Reverb Time is split into three bands), a crossfade between
 * them, and Width and Mix on the way out. That is the reference's panel, control for control.
 *
 * This module exists because the vendored reverb
 * (`engine/vendor/vital/src/synthesis/effects/reverb.cpp`) could not be made into it. It has no early
 * reflections at all, its band controls can only make a band decay FASTER than the rest, and three of
 * its faults are unreachable without editing vendored code:
 *
 *   - the wet level rises as the square root of the reverb time, so a long tail clipped the output;
 *   - its allpass diffusers sit INSIDE the feedback loop and are not scaled with Size, so the round
 *     trip is up to three times longer than its own T60 arithmetic assumes and a small room rang four
 *     times its stated time;
 *   - the network is not left/right symmetric, so a mono source came out up to 7.5 dB off centre.
 *
 * See docs/adrs/0009. The DSP primitives are still the vendored ones -- `poly_float`,
 * `OnePoleFilter`, `futils` -- the way `env.adsr` keeps the vendored envelope; what is ours is the
 * topology. Three things about it are worth knowing:
 *
 * **The diffusers are on the tank's INPUT, never inside its loop.** A line's round trip is then
 * exactly its own delay, which is what makes Reverb Time mean seconds.
 *
 * **The decay is three bands, per line, written as two cascaded first-order shelves and a scalar.** A
 * shelf written `x + (a - 1) * lowpass(x)` has squared magnitude `1 + (a^2 - 1)cos^2(phase)` for a
 * one-pole, so it runs monotonically between 1 and `a` and overshoots neither. That is what lets a
 * band ring LONGER than the middle one -- which the reference allows and the vendored shelves cannot
 * express -- without the loop gain sneaking past 1. `bandGains` still bounds the worst-case product.
 *
 * **The tank's input is scaled by `sqrt(kReferenceTime / time)`.** A feedback network's steady-state
 * amplitude grows as the square root of its decay time; dividing that back out is what keeps the wet
 * level where it was put, whatever Reverb Time is doing.
 *
 * Like every effect here, this is one instance per voice pair, reading the pair's FIRST voice and
 * mirroring the result onto the second -- the convention the vendored effects already follow, and the
 * reason the examples put a reverb after `voices.sum`.
 */

// ---------------------------------------------------------------------------------------- the surface

const PortDesc kIn[] = {
  {"in", "In", PortKind::Continuous, 1, SignalRole::Audio,
   "Audio to be reverberated. Stereo: the left and right lanes stay apart the whole way through"},
};

const PortDesc kOut[] = {
  {"out", "Out", PortKind::Continuous, 1, SignalRole::Audio, "The dry signal blended with the wet one by Mix"},
};

enum Mode : int { kRoom = 0, kHall = 1 };
const char* const kModeLabels[] = {"Room", "Hall"};

/// The reverb time the level normalisation is calibrated at: the reference instrument's own default.
constexpr float kReferenceTime = 1.26f;

const ParamDesc kParams[] = {
  {"mode", "Mode", 0.f, 1.f, 0.f, ParamUnit::None, ParamCurve::Linear,
   kParamEnum | kParamInteger | kParamNoSmooth | kParamPrimary, kModeLabels, countOf(kModeLabels),
   "select", "Early",
   "The kind of space the early reflections describe: a Room's arrive early and close together, a "
   "Hall's later and further apart"},
  {"size", "Size", 0.f, 200.f, 100.f, ParamUnit::Percent, ParamCurve::Linear,
   kParamPrimary | kParamModulatable, nullptr, 0, "knob", "Early",
   "How big that space is, as a proportion of its usual size. It moves the early reflections; the "
   "tail's length is Reverb Time and its density is Buildup"},
  {"predelay", "Pre-delay", 0.f, 100.f, 4.f, ParamUnit::Milliseconds, ParamCurve::Quartic,
   kParamPrimary | kParamModulatable, nullptr, 0, "knob", "Early",
   "Silence between the dry sound and the first reflection, in milliseconds"},
  {"diffusion", "Diffusion", 0.f, 100.f, 70.f, ParamUnit::Percent, ParamCurve::Linear,
   kParamPrimary | kParamModulatable, nullptr, 0, "knob", "Early",
   "How smoothly the early reflections are spread. At zero they are discrete taps; turned up they "
   "smear into one another"},
  {"buildup", "Buildup", 0.f, 100.f, 70.f, ParamUnit::Percent, ParamCurve::Linear,
   kParamPrimary | kParamModulatable, nullptr, 0, "knob", "Late",
   "How smoothly the tail's reflections are spread, by diffusing what goes into the tank"},
  {"time", "Reverb Time", 0.316f, 31.6f, kReferenceTime, ParamUnit::Seconds, ParamCurve::Log,
   kParamPrimary | kParamModulatable, nullptr, 0, "knob", "Late",
   "How long the tail takes to fall by 60 dB. The wet level does not change with it"},
  {"low_freq", "Low Band Split", 65.4f, 1480.f, 298.f, ParamUnit::Hz, ParamCurve::Log,
   kParamPrimary | kParamModulatable, nullptr, 0, "knob", "Late", "Where the low band ends"},
  {"low_factor", "Low Band Factor", 0.562f, 1.78f, 1.f, ParamUnit::Ratio, ParamCurve::Log,
   kParamPrimary | kParamModulatable, nullptr, 0, "knob", "Late",
   "The low band's reverb time, relative to Reverb Time. Above 1 the low end rings on after the rest"},
  {"high_freq", "High Band Split", 831.f, 11200.f, 4000.f, ParamUnit::Hz, ParamCurve::Log,
   kParamPrimary | kParamModulatable, nullptr, 0, "knob", "Late", "Where the high band begins"},
  {"high_factor", "High Band Factor", 0.562f, 1.78f, 1.f, ParamUnit::Ratio, ParamCurve::Log,
   kParamPrimary | kParamModulatable, nullptr, 0, "knob", "Late",
   "The high band's reverb time, relative to Reverb Time. Below 1 the top decays away first, which is "
   "what the air in a real room does"},
  {"late_mix", "Late Mix", 0.f, 100.f, 75.f, ParamUnit::Percent, ParamCurve::Linear,
   kParamPrimary | kParamModulatable, nullptr, 0, "knob", "Late",
   "Blends the early reflections (0%) with the tail (100%). It is a crossfade inside the wet signal; "
   "Mix still decides how much of that is heard"},
  {"width", "Width", 0.f, 150.f, 100.f, ParamUnit::Percent, ParamCurve::Linear,
   kParamPrimary | kParamModulatable, nullptr, 0, "knob", "Output",
   "Stereo width of the wet signal. 0% is mono, 100% is as the network made it"},
  {"mix", "Mix", 0.f, 100.f, 50.f, ParamUnit::Percent, ParamCurve::Linear,
   kParamPrimary | kParamModulatable, nullptr, 0, "knob", "Output",
   "How much of the output is the reverb rather than the signal that came in"},
  {"mod_amount", "Modulation", 0.f, 100.f, 20.f, ParamUnit::Percent, ParamCurve::Linear,
   kParamModulatable, nullptr, 0, "knob", "Modulation",
   "How far the tank's delays drift. A little of it keeps a long tail from ringing metallically. The "
   "reference instrument has no such control; this is the one place this module goes past its panel"},
  {"mod_rate", "Modulation Rate", 0.01f, 8.f, 0.25f, ParamUnit::Hz, ParamCurve::Log,
   kParamModulatable, nullptr, 0, "knob", "Modulation", "How fast that drift moves"},
};

enum ParamIndex : uint32_t {
  kMode = 0, kSize, kPredelay, kDiffusion, kBuildup, kTime, kLowFreq, kLowFactor, kHighFreq,
  kHighFactor, kLateMix, kWidth, kMix, kModAmount, kModRate
};

/// The reference's own grouping: Early along the top left, Late across the middle, Width and Mix on
/// the right under a meter. The two Modulation controls are not on the reference's panel and are not
/// on this one either -- they are reached through the inspector.
const char* const kFace[] = {
  "in select:mode size size predelay predelay diffusion diffusion buildup buildup time time time time meter meter out",
  ".  select:mode size size predelay predelay diffusion diffusion buildup buildup time time time time meter meter .",
  ".  .    low_freq low_freq low_factor low_factor high_freq high_freq high_factor high_factor late_mix late_mix width width mix mix .",
  ".  .    low_freq low_freq low_factor low_factor high_freq high_freq high_factor high_factor late_mix late_mix width width mix mix .",
};

// ------------------------------------------------------------------------------------- the network

/// The rate the delay tables below are written at. Everything is scaled to the running rate, so the
/// reverb sounds the same at 44.1 and at 96 kHz.
constexpr float kTuningRate = 44100.f;

/**
 * The tank's delay lines, as two groups of four.
 *
 * The left half of the stereo image is taken from the first group and the right half from the second,
 * so each side sees four lines of its own; the lengths are interleaved between the groups (A takes the
 * 1st, 4th, 6th and 8th of the sorted set, B the rest) so the two carry the same energy, which is what
 * keeps a mono source centred. Mutually prime lengths, so their echoes do not line up.
 */
constexpr float kTankDelaysA[4] = {1123.f, 1747.f, 2287.f, 2803.f};
constexpr float kTankDelaysB[4] = {1291.f, 1531.f, 1993.f, 2521.f};

/// The diffusers, in samples at `kTuningRate`, per channel. The early ones are short on purpose: their
/// total is subtracted from the tap times, so turning Diffusion does not move the first reflection,
/// and there is only room to subtract what a small Room's first tap can spare.
constexpr uint32_t kDiffusers = 4;
constexpr float kEarlyDiffusion[2][kDiffusers] = {{23.f, 41.f, 67.f, 97.f}, {29.f, 47.f, 73.f, 103.f}};
constexpr float kBuildupDiffusion[2][kDiffusers] = {{97.f, 149.f, 211.f, 293.f}, {103.f, 157.f, 223.f, 307.f}};

/// The early reflections: eight per channel, in milliseconds at Size 100%. A Room's arrive between 7
/// and 47 ms and a Hall's between 17 and 126, which is most of the difference between the two words.
constexpr uint32_t kEarlyTaps = 8;
constexpr float kTapMs[2][2][kEarlyTaps] = {
  {{7.3f, 11.9f, 16.1f, 21.7f, 27.3f, 33.1f, 38.9f, 44.3f},
   {8.9f, 13.3f, 18.7f, 23.9f, 29.7f, 35.3f, 41.1f, 46.7f}},
  {{17.1f, 27.3f, 39.1f, 52.7f, 67.9f, 84.3f, 101.1f, 119.3f},
   {21.3f, 31.7f, 44.3f, 58.1f, 73.9f, 90.7f, 108.3f, 126.1f}},
};

/// The longest an early tap can be -- the last Hall tap at Size 200% -- and the longest pre-delay.
constexpr float kMaxEarlySeconds = 2.f * 0.1261f;
constexpr float kMaxPredelaySeconds = 0.1f;
/// The furthest the modulation moves a tank delay, in samples at `kTuningRate`.
constexpr float kMaxDrift = 200.f;
/// Where the tail is 60 dB down: the amplitude the per-pass gains are solved for.
constexpr float kT60Amplitude = 0.001f;
/// The loop gain never reaches this, whatever the band factors ask for.
constexpr float kLoopCeiling = 0.999f;
/// The strongest an allpass diffuser is allowed to feed back. Past this it rings rather than spreads.
constexpr float kMaxDiffusion = 0.72f;
/// How long the pre-delay takes to reach a new setting. A jump would be a click, and a fast sweep
/// would be a pitch bend, so it glides.
constexpr float kPredelayGlideSeconds = 0.05f;
/// Chosen so that at `kReferenceTime`, Mix 100%, each section on its own sits at about the level of
/// the dry signal that made it. Measured, not derived: see docs/adrs/0009.
constexpr float kTankDrive = 0.70f;
constexpr float kEarlyDrive = 0.82f;
/**
 * How the tank's input is scaled against Reverb Time, as `(kReferenceTime / time) ^ kLevelExponent`.
 *
 * A feedback network's steady-state amplitude grows as the square root of its decay time, so 0.5 is
 * the number the physics gives and most of what this does. The rest is measured: over the knob's full
 * hundred-to-one range the square root alone still leaves a +3.2 dB drift, because a tail shorter than
 * the sound that excites it never reaches the steady state the model assumes. 0.58 flattens it to
 * under a decibel on both a sine and a sawtooth source.
 */
constexpr float kLevelExponent = 0.58f;

/// The signs the tank is fed with. Half of each channel's lines take the signal inverted, so what
/// enters the network is not one impulse in eight places, and the pattern differs between the two
/// halves so a mono source does not put identical content on both sides.
constexpr float kInject[8] = {1.f, -1.f, -1.f, 1.f, 1.f, 1.f, -1.f, -1.f};

/**
 * The feedback matrix: a normalised Hadamard, applied as three butterfly stages.
 *
 * It has to be orthogonal (or the network gains or loses energy on its own) and it has to MIX (or the
 * lines are eight independent comb filters and the tail is a ringing chord rather than a room). The
 * Householder reflection the vendored reverb uses is orthogonal but only mixes what lies along its
 * one axis: fed a zero-mean pattern like `kInject`, it is the identity, which is exactly the failure
 * mode this replaced. A Hadamard has no such blind spot -- every line ends up in every other.
 */
void hadamard(float* v) {
  for (uint32_t k = 0; k < 8; k += 2) {
    const float a = v[k];
    v[k] = a + v[k + 1];
    v[k + 1] = a - v[k + 1];
  }
  for (uint32_t k = 0; k < 8; k += 4)
    for (uint32_t j = 0; j < 2; ++j) {
      const float a = v[k + j];
      v[k + j] = a + v[k + j + 2];
      v[k + j + 2] = a - v[k + j + 2];
    }
  for (uint32_t j = 0; j < 4; ++j) {
    const float a = v[j];
    v[j] = a + v[j + 4];
    v[j + 4] = a - v[j + 4];
  }
  constexpr float norm = 0.35355339f;   // 1 / sqrt(8)
  for (uint32_t k = 0; k < 8; ++k) v[k] *= norm;
}

/// A ring buffer read at a fractional delay. Power-of-two length, allocated once in `prepare`.
struct Line {
  std::vector<float> buf;
  uint32_t mask = 0;
  uint32_t w = 0;

  void alloc(uint32_t minLength) {
    uint32_t n = 8;
    while (n < minLength) n <<= 1;
    buf.assign(n, 0.f);
    mask = n - 1;
    w = 0;
  }
  void clear() {
    std::fill(buf.begin(), buf.end(), 0.f);
    w = 0;
  }
  /// The sample written `delay` frames ago, linearly interpolated. Read BEFORE `push`; `delay >= 1`.
  float read(float delay) const {
    const float d = std::clamp(delay, 1.f, static_cast<float>(mask) - 1.f);
    const uint32_t i = static_cast<uint32_t>(d);
    const float f = d - static_cast<float>(i);
    const float a = buf[(w - i) & mask];
    const float b = buf[(w - i - 1) & mask];
    return a + (b - a) * f;
  }
  void push(float v) {
    buf[w] = v;
    w = (w + 1) & mask;
  }
};

/// A Schroeder allpass: the signal delayed and fed back through itself, which spreads an impulse in
/// time without colouring it. `k` is how much of it is spread.
struct Allpass {
  std::vector<float> buf;
  uint32_t mask = 0;
  uint32_t w = 0;
  uint32_t delay = 1;

  void alloc(uint32_t d) {
    delay = std::max(1u, d);
    uint32_t n = 8;
    while (n < delay + 2) n <<= 1;
    buf.assign(n, 0.f);
    mask = n - 1;
    w = 0;
  }
  void clear() {
    std::fill(buf.begin(), buf.end(), 0.f);
    w = 0;
  }
  float tick(float x, float k) {
    const float d = buf[(w - delay) & mask];
    const float v = x + k * d;
    buf[w] = v;
    w = (w + 1) & mask;
    return d - k * v;
  }
};

/// One stereo reverb: one per voice pair. Allocated in `prepare`, cleared in `reset`, never resized
/// on the audio thread.
struct Tank {
  Line pre[2];                       // the pre-delay, one line per channel
  Allpass earlyDiff[2][kDiffusers];  // spreads what the early taps read      (Diffusion)
  Line early[2];                     // what the early taps read from
  Allpass buildDiff[2][kDiffusers];  // spreads what enters the tank          (Buildup)
  Line lines[8];                     // the tank: group A is 0..3, group B is 4..7
  vital::OnePoleFilter<> lowShelf[2], highShelf[2];

  float predelay = 1.f;              // glides towards the knob, so a change neither clicks nor bends
  float modPhase = 0.f;
  Sample driftA{0.f}, driftB{0.f};   // where the modulation left the delays at the end of the block

  /// What the per-sample ramps start this block at.
  float wet = 0.f, dry = 1.f, width = 1.f, lateMix = 1.f, earlyMix = 0.f, drive = 0.f;
  bool primed = false;               // false until the first block has set the ramps to their targets

  void clear() {
    for (uint32_t ch = 0; ch < 2; ++ch) {
      pre[ch].clear();
      early[ch].clear();
      for (uint32_t i = 0; i < kDiffusers; ++i) {
        earlyDiff[ch][i].clear();
        buildDiff[ch][i].clear();
      }
      lowShelf[ch].reset(vital::constants::kFullMask);
      highShelf[ch].reset(vital::constants::kFullMask);
    }
    for (Line& l : lines) l.clear();
    predelay = 1.f;
    modPhase = 0.f;
    driftA = Sample(0.f);
    driftB = Sample(0.f);
    primed = false;
  }
};

/// The early tap gains: each reflection quieter than the last, some inverted so the set does not read
/// as one echo repeated, and the whole set scaled to carry unit energy.
const float* tapGains() {
  static const std::vector<float> g = [] {
    std::vector<float> v(kEarlyTaps);
    float energy = 0.f;
    for (uint32_t i = 0; i < kEarlyTaps; ++i) {
      v[i] = std::pow(0.78f, static_cast<float>(i)) * ((i % 3 == 1) ? -1.f : 1.f);
      energy += v[i] * v[i];
    }
    const float norm = 1.f / std::sqrt(energy);
    for (float& x : v) x *= norm;
    return v;
  }();
  return g.data();
}

/// The three per-pass gains one group of lines decays by, and the two shelf gains that express the
/// outer two relative to the middle one.
struct BandGains {
  Sample mid{1.f}, lowRel{1.f}, highRel{1.f};
};

/**
 * Solves the per-pass gains for one group of delays.
 *
 * A line of `delay` samples goes round `sr / delay` times a second, and the band is 60 dB down after
 * `time * factor` seconds, so its gain per pass is `kT60Amplitude ^ (delay / (time * factor * sr))`.
 * The loop filter's magnitude is bounded by `max(1, lowRel) * max(1, highRel) * mid` (each shelf runs
 * monotonically between 1 and its own gain), so that product is what has to stay under one -- a band
 * factor of 1.78 on both ends of a 31.6 s tail comes within a thousandth of it.
 */
BandGains bandGains(Sample delays, float time, float lowFactor, float highFactor, float sampleRate) {
  const Sample perSecond = delays * (1.f / sampleRate);
  const Sample mid = vital::utils::pow(kT60Amplitude, perSecond * (1.f / time));
  const Sample low = vital::utils::pow(kT60Amplitude, perSecond * (1.f / (time * lowFactor)));
  const Sample high = vital::utils::pow(kT60Amplitude, perSecond * (1.f / (time * highFactor)));

  BandGains g;
  g.lowRel = low / mid;
  g.highRel = high / mid;
  const Sample bound = vital::utils::max(mid, low) * vital::utils::max(mid, high) / mid;
  const Sample safe = vital::utils::min(Sample(1.f), Sample(kLoopCeiling) / bound);
  g.mid = mid * safe;
  return g;
}

// -------------------------------------------------------------------------------------- the module

class FxReverb final : public Module {
public:
  void prepare(const PrepareInfo& info) override {
    sampleRate_ = static_cast<float>(info.sampleRate);
    const float scale = sampleRate_ / kTuningRate;
    for (uint32_t i = 0; i < 4; ++i) {
      delayA_[i] = kTankDelaysA[i] * scale;
      delayB_[i] = kTankDelaysB[i] * scale;
    }
    drift_ = kMaxDrift * scale;
    predelayGlide_ = 1.f / std::max(1.f, kPredelayGlideSeconds * sampleRate_);
    for (uint32_t ch = 0; ch < 2; ++ch) {
      earlyDiffSamples_[ch] = 0.f;
      for (uint32_t i = 0; i < kDiffusers; ++i)
        earlyDiffSamples_[ch] += std::round(kEarlyDiffusion[ch][i] * scale);
    }

    const uint32_t preLen = static_cast<uint32_t>(kMaxPredelaySeconds * sampleRate_) + 8;
    const uint32_t earlyLen = static_cast<uint32_t>(kMaxEarlySeconds * sampleRate_) + 8;
    float longest = 0.f;
    for (uint32_t i = 0; i < 4; ++i) longest = std::max(longest, std::max(delayA_[i], delayB_[i]));
    const uint32_t tankLen = static_cast<uint32_t>(longest + drift_) + 8;

    tanks_.clear();
    for (uint32_t p = 0; p < (info.voiceCount + 1) / 2; ++p) {
      tanks_.push_back(std::make_unique<Tank>());
      Tank& t = *tanks_.back();
      for (uint32_t ch = 0; ch < 2; ++ch) {
        t.pre[ch].alloc(preLen);
        t.early[ch].alloc(earlyLen);
        for (uint32_t i = 0; i < kDiffusers; ++i) {
          t.earlyDiff[ch][i].alloc(static_cast<uint32_t>(std::round(kEarlyDiffusion[ch][i] * scale)));
          t.buildDiff[ch][i].alloc(static_cast<uint32_t>(std::round(kBuildupDiffusion[ch][i] * scale)));
        }
      }
      for (Line& l : t.lines) l.alloc(tankLen);
      t.clear();
    }
    scratch_.assign(static_cast<size_t>(info.maxBlock) * 2, 0.f);
    for (Channel& ch : channels_) ch = Channel{};
    block_ = 0;
  }

  void reset(uint32_t voicePair) override {
    if (voicePair < tanks_.size()) tanks_[voicePair]->clear();
  }

  void process(ProcessContext& c) override {
    if (c.voice >= tanks_.size()) return;
    const uint32_t n = c.numFrames;
    if (n == 0) return;
    Tank& t = *tanks_[c.voice];
    const Sample* in = c.in(0).readOr();
    Sample* out = c.out(0).data;
    const bool metering = c.telemetry != nullptr && c.displaySlot != kNoTelemetrySlotCtx;
    if (metering && c.firstPass) std::fill_n(scratch_.data(), static_cast<size_t>(n) * 2, 0.f);

    // 1. The knobs, once. The engine has already smoothed them, so the value at the last frame is the
    //    one to ramp towards; everything derived from it is stepped or ramped from here.
    const uint32_t last = n - 1;
    auto knob = [&](uint32_t p) { return lanes::lane(c.param(p).at(last), 0); };
    const int mode = std::clamp(static_cast<int>(knob(kMode) + 0.5f), 0, 1);
    const float size = std::max(0.05f, knob(kSize) * 0.01f);
    const float diffusion = std::clamp(knob(kDiffusion) * 0.01f, 0.f, 1.f) * kMaxDiffusion;
    const float buildup = std::clamp(knob(kBuildup) * 0.01f, 0.f, 1.f) * kMaxDiffusion;
    const float time = std::clamp(knob(kTime), 0.05f, 60.f);
    const float lowFactor = std::clamp(knob(kLowFactor), 0.25f, 4.f);
    const float highFactor = std::clamp(knob(kHighFactor), 0.25f, 4.f);

    // 2. What the tank runs on. Stepped per block: these live inside a feedback loop whose own time
    //    constant is orders of magnitude longer than a block, so a step in them cannot click.
    const BandGains ga = bandGains(Sample(delayA_[0], delayA_[1], delayA_[2], delayA_[3]),
                                   time, lowFactor, highFactor, sampleRate_);
    const BandGains gb = bandGains(Sample(delayB_[0], delayB_[1], delayB_[2], delayB_[3]),
                                   time, lowFactor, highFactor, sampleRate_);
    const int sr = static_cast<int>(sampleRate_);
    const Sample cLow = vital::OnePoleFilter<>::computeCoefficient(
        Sample(std::clamp(knob(kLowFreq), 20.f, sampleRate_ * 0.45f)), sr);
    const Sample cHigh = vital::OnePoleFilter<>::computeCoefficient(
        Sample(std::clamp(knob(kHighFreq), 20.f, sampleRate_ * 0.45f)), sr);

    // 3. The early taps, in samples, less the diffuser chain that now runs ahead of them: turning
    //    Diffusion spreads the reflections without moving the first one.
    float tap[2][kEarlyTaps];
    for (uint32_t ch = 0; ch < 2; ++ch)
      for (uint32_t k = 0; k < kEarlyTaps; ++k)
        tap[ch][k] = std::max(1.f, kTapMs[mode][ch][k] * 0.001f * sampleRate_ * size - earlyDiffSamples_[ch]);
    const float* gain = tapGains();

    // 4. The modulation: one slow rotation, eight phases of it, ramped across the block rather than
    //    stepped, because a step in a delay length is a click.
    const float rate = std::clamp(knob(kModRate), 0.f, 20.f);
    const float depth = std::clamp(knob(kModAmount) * 0.01f, 0.f, 1.f) * drift_;
    t.modPhase += rate * static_cast<float>(n) / sampleRate_;
    t.modPhase -= std::floor(t.modPhase);
    Sample targetA(0.f), targetB(0.f);
    for (uint32_t i = 0; i < 4; ++i) {
      const float phase = t.modPhase + static_cast<float>(i) * 0.125f;
      targetA.set(i, depth * std::sin(2.f * vital::kPi * phase));
      targetB.set(i, depth * std::sin(2.f * vital::kPi * (phase + 0.5f)));
    }
    const float tick = 1.f / static_cast<float>(n);
    const Sample dDriftA = (targetA - t.driftA) * tick;
    const Sample dDriftB = (targetB - t.driftB) * tick;
    Sample driftA = t.driftA, driftB = t.driftB;
    t.driftA = targetA;
    t.driftB = targetB;

    // 5. The output stage, ramped: a crossfade and a width are heard directly, so they move sample by
    //    sample. `equalPowerFade` is the vendored curve, which is the right one for a wet signal that
    //    is uncorrelated with the dry.
    const float m = std::clamp(knob(kMix) * 0.01f, 0.f, 1.f);
    const float wetTarget = lanes::lane(vital::futils::equalPowerFade(Sample(m)), 0);
    const float dryTarget = lanes::lane(vital::futils::equalPowerFadeInverse(Sample(m)), 0);
    const float widthTarget = std::clamp(knob(kWidth) * 0.01f, 0.f, 1.5f);
    // Equal power, not linear: the early cluster and the tail are uncorrelated, so a straight
    // crossfade would dip 3 dB in the middle of the knob. The two sections are gain-matched
    // (`kEarlyDrive`, `kTankDrive`), which is what makes that the whole of the correction.
    const float lm = std::clamp(knob(kLateMix) * 0.01f, 0.f, 1.f);
    const float lateTarget = lanes::lane(vital::futils::equalPowerFade(Sample(lm)), 0);
    const float earlyTarget = lanes::lane(vital::futils::equalPowerFadeInverse(Sample(lm)), 0);
    const float driveTarget = kTankDrive * std::pow(kReferenceTime / time, kLevelExponent);
    if (!t.primed) {
      t.earlyMix = earlyTarget;
      t.wet = wetTarget;
      t.dry = dryTarget;
      t.width = widthTarget;
      t.lateMix = lateTarget;
      t.drive = driveTarget;
      t.primed = true;
    }
    const float dWet = (wetTarget - t.wet) * tick;
    const float dDry = (dryTarget - t.dry) * tick;
    const float dWidth = (widthTarget - t.width) * tick;
    const float dLate = (lateTarget - t.lateMix) * tick;
    const float dEarly = (earlyTarget - t.earlyMix) * tick;
    const float dDrive = (driveTarget - t.drive) * tick;
    float wet = t.wet, dry = t.dry, width = t.width, late = t.lateMix, early = t.earlyMix, drive = t.drive;
    t.wet = wetTarget;
    t.dry = dryTarget;
    t.width = widthTarget;
    t.lateMix = lateTarget;
    t.earlyMix = earlyTarget;
    t.drive = driveTarget;

    const float predelayTarget = std::max(1.f, knob(kPredelay) * 0.001f * sampleRate_);

    for (uint32_t i = 0; i < n; ++i) {
      const Sample x = in[i];
      const float xL = x[0], xR = x[1];

      // Pre-delay, glided rather than ramped: a linear sweep to a new length would bend the pitch of
      // whatever is in the line, and this is heard before anything else in the chain.
      t.predelay += (predelayTarget - t.predelay) * predelayGlide_;
      const float pL = t.pre[0].read(t.predelay);
      const float pR = t.pre[1].read(t.predelay);
      t.pre[0].push(xL);
      t.pre[1].push(xR);

      // Early: diffuse, then tap. Both orders sound similar; this one keeps the first reflection
      // where Size put it whatever Diffusion is doing.
      float eL = pL, eR = pR;
      for (uint32_t s = 0; s < kDiffusers; ++s) {
        eL = t.earlyDiff[0][s].tick(eL, diffusion);
        eR = t.earlyDiff[1][s].tick(eR, diffusion);
      }
      float earlyL = 0.f, earlyR = 0.f;
      for (uint32_t k = 0; k < kEarlyTaps; ++k) {
        earlyL += gain[k] * t.early[0].read(tap[0][k]);
        earlyR += gain[k] * t.early[1].read(tap[1][k]);
      }
      t.early[0].push(eL);
      t.early[1].push(eR);
      earlyL *= kEarlyDrive;
      earlyR *= kEarlyDrive;

      // Buildup: what the tank is fed has already been spread, so the tail arrives dense rather than
      // as a train of discrete echoes. These diffusers are on the way IN, not in the loop.
      float bL = pL, bR = pR;
      for (uint32_t s = 0; s < kDiffusers; ++s) {
        bL = t.buildDiff[0][s].tick(bL, buildup);
        bR = t.buildDiff[1][s].tick(bR, buildup);
      }

      // The tank. Read the eight lines, decay each by its three-band gain, take the two halves of the
      // stereo image out of them, mix them through the Hadamard (orthogonal, so it moves energy
      // between the lines without creating or destroying any), feed the input in, write back.
      driftA += dDriftA;
      driftB += dDriftB;
      const Sample readA(t.lines[0].read(delayA_[0] + driftA[0]), t.lines[1].read(delayA_[1] + driftA[1]),
                         t.lines[2].read(delayA_[2] + driftA[2]), t.lines[3].read(delayA_[3] + driftA[3]));
      const Sample readB(t.lines[4].read(delayB_[0] + driftB[0]), t.lines[5].read(delayB_[1] + driftB[1]),
                         t.lines[6].read(delayB_[2] + driftB[2]), t.lines[7].read(delayB_[3] + driftB[3]));
      const Sample decayedA = decay(readA, t.lowShelf[0], t.highShelf[0], cLow, cHigh, ga);
      const Sample decayedB = decay(readB, t.lowShelf[1], t.highShelf[1], cLow, cHigh, gb);

      float v[8] = {decayedA[0], decayedA[1], decayedA[2], decayedA[3],
                    decayedB[0], decayedB[1], decayedB[2], decayedB[3]};
      const float lateL = (v[0] + v[1] - v[2] - v[3]) * 0.5f;
      const float lateR = (v[4] - v[5] + v[6] - v[7]) * 0.5f;

      hadamard(v);
      drive += dDrive;
      for (uint32_t k = 0; k < 4; ++k) {
        t.lines[k].push(v[k] + kInject[k] * bL * drive);
        t.lines[k + 4].push(v[k + 4] + kInject[k + 4] * bR * drive);
      }

      // Late Mix, then Width on the wet alone, then Mix against the dry that came in.
      late += dLate;
      early += dEarly;
      width += dWidth;
      wet += dWet;
      dry += dDry;
      const float wetLraw = earlyL * early + lateL * late;
      const float wetRraw = earlyR * early + lateR * late;
      const float mid = (wetLraw + wetRraw) * 0.5f;
      const float side = (wetLraw - wetRraw) * 0.5f * width;
      const float oL = dry * xL + wet * (mid + side);
      const float oR = dry * xR + wet * (mid - side);
      if (out != nullptr) out[i] = Sample(oL, oR, oL, oR);
      if (metering) {
        scratch_[i * 2] += oL;
        scratch_[i * 2 + 1] += oR;
      }
    }

    if (metering && c.lastPass) publishMeter(c);
  }

private:
  /// One pass of the loop filter: a low shelf whose gain below Low Band Split is `lowRel`, a high
  /// shelf whose gain above High Band Split is `highRel`, and the middle band's own decay. Written in
  /// the form whose magnitude runs monotonically between 1 and the shelf gain, so a band that rings
  /// longer than the middle one cannot push the loop past unity (see `bandGains`).
  static Sample decay(Sample x, vital::OnePoleFilter<>& lo, vital::OnePoleFilter<>& hi, Sample cLow,
                      Sample cHigh, const BandGains& g) {
    const Sample low = lo.tickBasic(x, cLow);
    Sample y = x + (g.lowRel - Sample(1.f)) * low;
    const Sample high = hi.tickBasic(y, cHigh);
    y = g.highRel * y + (Sample(1.f) - g.highRel) * high;
    return y * g.mid;
  }

  /// The level meter, with the ballistics `display.meter` uses: a peak that falls at a readable rate
  /// and a clip that stays lit long enough to be seen.
  void publishMeter(ProcessContext& c) {
    static constexpr float kPeakFallDbPerSecond = 20.f;
    static constexpr float kClipHoldSeconds = 1.5f;
    ++block_;
    const float seconds = static_cast<float>(c.numFrames) / sampleRate_;
    const float fall = std::pow(10.f, -(kPeakFallDbPerSecond * seconds) / 20.f);
    for (uint32_t k = 0; k < kChannels; ++k) {
      Channel& ch = channels_[k];
      float peak = 0.f, sum = 0.f;
      bool clipped = false;
      for (uint32_t i = 0; i < c.numFrames; ++i) {
        const float v = scratch_[i * kChannels + k];
        const float a = std::fabs(v);
        if (a > peak) peak = a;
        sum += v * v;
        if (a > 1.f) clipped = true;
      }
      ch.peak = std::max(peak, ch.peak * fall);
      if (clipped) ch.clipHold = kClipHoldSeconds * sampleRate_;
      else ch.clipHold = std::max(0.f, ch.clipHold - static_cast<float>(c.numFrames));
      float* v = values_ + k * kMeterFloatsPerChannel;
      v[0] = ch.peak;
      v[1] = c.numFrames > 0 ? std::sqrt(sum / static_cast<float>(c.numFrames)) : 0.f;
      v[2] = ch.clipHold > 0.f ? 1.f : 0.f;
    }
    c.telemetry->writeMeter(c.displaySlot, values_, kChannels, block_);
  }

  static constexpr uint32_t kChannels = 2;
  struct Channel {
    float peak = 0.f;
    float clipHold = 0.f;
  };

  std::vector<std::unique_ptr<Tank>> tanks_;
  std::vector<float> scratch_;   // the block's output, interleaved, summed across voice pairs
  Channel channels_[kChannels];
  float values_[kChannels * kMeterFloatsPerChannel] = {};
  float sampleRate_ = 48000.f;
  float delayA_[4] = {}, delayB_[4] = {};
  float earlyDiffSamples_[2] = {};
  float drift_ = 0.f;
  float predelayGlide_ = 1.f;
  uint64_t block_ = 0;
};

}  // namespace

// Explicit `extern` (see AudioOut.cpp): a namespace-scope `const` is internal linkage by default.
extern const ModuleDescriptor kFxReverb{kModuleAbiVersion, "fx.reverb", "Reverb", "Audio FX",
  "An algorithmic reverb: early reflections whose Mode and Size say what room this is, a tail whose "
  "Reverb Time is split into three bands so the low end can ring on after the top has gone, a Late Mix "
  "between the two, and Width and Mix on the way out. It is a global effect: put it after voices.sum "
  "so it runs once on the whole chord rather than once per voice.",
  kIn, countOf(kIn), kOut, countOf(kOut), kParams, countOf(kParams),
  kModuleWritesTelemetry | kModulePublishesMeter, 1,
  [] () -> Module* { return new FxReverb(); }, kFace, countOf(kFace)};

}  // namespace pg::modules

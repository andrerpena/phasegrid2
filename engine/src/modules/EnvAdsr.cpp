#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <memory>
#include <vector>

#include "core/Module.hpp"
#include "core/Voices.hpp"
#include "envelope.h"
#include "futils.h"
#include "vital/Triggers.hpp"

namespace pg::modules {
namespace {

/**
 * `env.adsr` -- the four-stage envelope, modelled on the reference instrument's ADSR.
 *
 * The maths is the vendored one: each voice pair owns a `vital::Envelope`
 * (`engine/vendor/vital/src/synthesis/modulators/envelope.cpp`), driven at audio rate so the envelope
 * moves within a block rather than stepping once per block. That processor's stage machine already
 * behaves the way the reference instrument's own documentation describes -- the attack runs from the
 * envelope's CURRENT value to full scale over exactly the attack time, the release from the current
 * value to zero over exactly the release time -- and its three power inputs feed `futils::powerScale`,
 * which is what a "set curve" is. What this module replaces is the vendored WRAPPER
 * (`vital::EnvelopeModule`), whose controls carry that library's own ranges through a quartic scaling
 * chain: an Attack of 0..2.378 that means 0..32 seconds, with delay and hold stages we do not want and
 * no room for a signal path. See docs/adrs/0008.
 *
 * So this is an ordinary phasegrid module that owns a vendored `Processor` and plugs its own values
 * into it. Delay and Hold are held at zero for the life of the instance, which is what makes it four
 * stages: with `delay_time == 0` a trigger goes straight to the attack, and with `hold_time == 0` the
 * attack transitions straight into the decay.
 *
 * It is a signal path as well as a modulator, which is the point of the shape: an oscillator into
 * Signal In and Signal Out into the mix needs no separate amplifier, and Envelope Out still drives
 * anything else. Bias Out is the envelope less its sustain level, so it rests at zero while a note is
 * held and swings either way around it -- what you reach for to modulate a pitch or a cutoff without
 * a permanent offset.
 *
 * An unconnected Gate follows the note, which is this instrument's answer to the reference's `Gate on
 * Notes` -- a pre-cord we have no equivalent of, but a question the voice pool can already answer:
 * inside an instrument a voice IS its note, and `VoiceActivity` says which voices are holding one.
 * `display.piano` reads the same thing for the same reason. Without it the obvious patch -- an
 * oscillator through the envelope into the output -- is silent, and silence is a bad way to learn that
 * a module needs a cable nothing about it says is missing.
 */

// ---------------------------------------------------------------------------------------- the surface

const PortDesc kIn[] = {
  {"signal", "In", PortKind::Continuous, 1, SignalRole::Any,
   "Signal to be scaled by the envelope. Leave it unconnected to use the module as a modulator alone"},
  {"gate", "Gate", PortKind::Continuous, 1, SignalRole::Gate,
   "High starts the attack stage; low starts the release. Inside an instrument the voices already know "
   "this, so leaving it unconnected follows the note each voice is playing; connect it for an envelope "
   "that opens on something else, or for edges placed to the sample"},
};

const PortDesc kOut[] = {
  {"signal", "Out", PortKind::Continuous, 1, SignalRole::Any, "The input signal with the envelope applied"},
  {"env", "Env", PortKind::Continuous, 1, SignalRole::Cv, "The envelope itself, 0 to 1"},
  {"bias", "Bias", PortKind::Continuous, 1, SignalRole::Cv,
   "The envelope less its sustain level, so it approaches zero while a note is held: with Sustain at "
   "75%, this runs from -0.75 to +0.25"},
};

/// The three models, in the order the reference instrument lists them.
enum Model : int { kAnalog = 0, kRelative = 1, kDigital = 2 };
const char* const kModelLabels[] = {"Analog", "Relative", "Digital"};

/// The longest any stage can be. The reference instrument's range, and long enough that the quartic
/// taper leaves most of the knob under a second, where every musical setting is.
constexpr float kMaxStageSeconds = 8.f;

/**
 * The set curves, as powers for `futils::powerScale`.
 *
 * The vendored envelope NEGATES the attack power before using it, so a positive number here is the
 * same shape as the negative ones below: a segment that moves fast and then eases, which is what a
 * capacitor charging through a resistor does and what "analog" means on this switch. The vendored
 * library ships -2 for its own decay and release; the attack matches it.
 */
constexpr float kAnalogAttackPower = 2.f;
constexpr float kAnalogDecayPower = -2.f;
constexpr float kAnalogReleasePower = -2.f;

const ParamDesc kParams[] = {
  {"attack", "Attack", 0.f, kMaxStageSeconds, 0.001f, ParamUnit::Seconds, ParamCurve::Quartic,
   kParamPrimary | kParamModulatable, nullptr, 0, "knob", nullptr,
   "Rise time from the envelope's current value to full scale"},
  {"decay", "Decay", 0.f, kMaxStageSeconds, 1.f, ParamUnit::Seconds, ParamCurve::Quartic,
   kParamPrimary | kParamModulatable, nullptr, 0, "knob", nullptr,
   "Fall time after the attack stage, down to the sustain level"},
  {"sustain", "Sustain", 0.f, 100.f, 100.f, ParamUnit::Percent, ParamCurve::Linear,
   kParamPrimary | kParamModulatable, nullptr, 0, "knob", nullptr,
   "The level where the decay stage ends, and where the envelope stays while the gate is high"},
  {"release", "Release", 0.f, kMaxStageSeconds, 0.1f, ParamUnit::Seconds, ParamCurve::Quartic,
   kParamPrimary | kParamModulatable, nullptr, 0, "knob", nullptr,
   "Fall time from the envelope's current value to zero, once the gate drops"},
  {"model", "Model", 0.f, 2.f, 0.f, ParamUnit::None, ParamCurve::Linear,
   kParamEnum | kParamInteger | kParamNoSmooth, kModelLabels, countOf(kModelLabels), "select", nullptr,
   "Analog: set curves, and a non-linear amplifier on Signal Out. Relative: the same curves, but each "
   "knob is the time to cross the WHOLE range, so a shorter move takes proportionally less time. "
   "Digital: straight lines and exact timing"},
  {"lifetime", "Affect voice lifetime", 0.f, 1.f, 1.f, ParamUnit::None, ParamCurve::Linear,
   kParamInteger | kParamNoSmooth, nullptr, 0, "toggle", nullptr,
   "Keep the voice alive until this envelope has finished its release. Off, the envelope still plays "
   "but has no say in when the voice ends"},
};

enum ParamIndex : uint32_t { kAttack = 0, kDecay, kSustain, kRelease, kModel, kLifetime };
enum InputIndex : uint32_t { kSignalIn = 0, kGateIn };
enum OutputIndex : uint32_t { kSignalOut = 0, kEnvOut, kBiasOut };

/// The model switch in the corner, the picture across the top, the four knobs along the bottom, the
/// signal and the gate down the left and the three outputs down the right.
const char* const kFace[] = {
  "select:model adsr   adsr   adsr  adsr  adsr    adsr    adsr    adsr    out:signal",
  "in:signal    adsr   adsr   adsr  adsr  adsr    adsr    adsr    adsr    env       ",
  "gate         attack attack decay decay sustain sustain release release bias      ",
  ".            attack attack decay decay sustain sustain release release .         ",
};

// ------------------------------------------------------------------------------------- the picture

/// How much of the drawn width the sustain plateau takes. The rest is shared by the attack, the decay
/// and the release in proportion to their times, so the picture is the shape of the settings.
constexpr float kSustainWidth = 0.25f;

/// Everything the picture is drawn from, in the units the envelope runs in.
struct Shape {
  float attack = 0.f, decay = 0.f, sustain = 1.f, release = 0.f;
  int model = kAnalog;
  /// Where the envelope has got to: the vendored stage plus how far through it, and the level. Stage
  /// below `vital::kVoiceIdle` means it is not running and the picture gets no playhead.
  float stage = static_cast<float>(vital::kInvalid);
  float position = 0.f;
  float value = 0.f;
};

float attackPowerOf(int model) { return model == kDigital ? 0.f : kAnalogAttackPower; }
float decayPowerOf(int model) { return model == kDigital ? 0.f : kAnalogDecayPower; }
float releasePowerOf(int model) { return model == kDigital ? 0.f : kAnalogReleasePower; }

/// The x each stage ends at, as a fraction of the width. `end` is where the release reaches zero.
struct Breaks {
  float attack = 0.f, decay = 0.f, sustain = kSustainWidth, end = 1.f;
};

Breaks breaksOf(const Shape& s) {
  Breaks b;
  const float total = s.attack + s.decay + s.release;
  const float span = 1.f - kSustainWidth;
  if (total <= 0.f) {
    // Every stage instant: a plateau at the sustain level and nothing else to show.
    b.attack = b.decay = 0.f;
    b.sustain = kSustainWidth;
    b.end = kSustainWidth;
    return b;
  }
  b.attack = s.attack / total * span;
  b.decay = b.attack + s.decay / total * span;
  b.sustain = b.decay + kSustainWidth;
  b.end = b.sustain + s.release / total * span;
  return b;
}

/// The envelope's level at one point of the picture, by the same arithmetic the vendored processor uses.
float levelAt(const Shape& s, const Breaks& b, float x) {
  const float sustain = std::clamp(s.sustain, 0.f, 1.f);
  if (x < b.attack)
    return vital::futils::powerScale((x - 0.f) / b.attack, -attackPowerOf(s.model));
  if (x < b.decay) {
    const float t = (x - b.attack) / std::max(b.decay - b.attack, 1e-9f);
    return 1.f - (1.f - sustain) * vital::futils::powerScale(t, decayPowerOf(s.model));
  }
  if (x < b.sustain) return sustain;
  if (x < b.end) {
    const float t = (x - b.sustain) / std::max(b.end - b.sustain, 1e-9f);
    return sustain * (1.f - vital::futils::powerScale(t, releasePowerOf(s.model)));
  }
  return 0.f;
}

/// Where the playhead sits on that x axis, or -1 when the envelope is not running.
float playheadOf(const Shape& s, const Breaks& b) {
  const int stage = static_cast<int>(std::lround(std::floor(s.stage)));
  const float p = std::clamp(s.position, 0.f, 1.f);
  switch (stage) {
    case vital::kVoiceOn: return b.attack * p;
    // The envelope holds at the end of its decay for as long as the gate is high, so a held note rests
    // on the corner where the decay meets the sustain -- which is where the reference draws it too.
    case vital::kVoiceDecay: return b.attack + (b.decay - b.attack) * p;
    case vital::kVoiceOff: return b.sustain + (b.end - b.sustain) * p;
    default: return -1.f;
  }
}

/// Fills a preview buffer with the picture: `kEnvelopePictureHeader` floats and then the curve.
void drawPicture(const Shape& s, float* out, uint32_t count) {
  if (count < kEnvelopePictureHeader) return;
  const Breaks b = breaksOf(s);
  out[kEnvelopeAttackEnd] = b.attack;
  out[kEnvelopeDecayEnd] = b.decay;
  out[kEnvelopeSustainEnd] = b.sustain;
  out[kEnvelopeSustainLevel] = std::clamp(s.sustain, 0.f, 1.f);
  out[kEnvelopePlayheadX] = playheadOf(s, b);
  out[kEnvelopePlayheadY] = std::clamp(s.value, 0.f, 1.f);
  out[kEnvelopeStage] = s.stage;
  out[kEnvelopeReserved] = 0.f;
  const uint32_t points = count - kEnvelopePictureHeader;
  for (uint32_t i = 0; i < points; ++i) {
    const float x = points < 2 ? 0.f : static_cast<float>(i) / static_cast<float>(points - 1);
    out[kEnvelopePictureHeader + i] = levelAt(s, b, x);
  }
}

// -------------------------------------------------------------------------------------- the module

/// One voice pair's envelope and everything plugged into it.
struct Pair {
  vital::Envelope envelope;
  /// The nine control inputs, in the vendored processor's own order. Delay and Hold stay at zero.
  vital::cr::Output delay, attack, attackPower, hold, decay, decayPower, sustain, release, releasePower;
  /// The gate, as the vendored framework wants it: one trigger per lane per block.
  vital::Output trigger;
  Sample lastGate = Sample(0.f);
  /// The envelope's level at the end of the last block, which is what the Relative model measures its
  /// remaining distance from.
  Sample lastValue = Sample(0.f);
  /// The Relative model's per-lane time multipliers, latched when the stage they belong to starts.
  Sample attackScale = Sample(1.f);
  Sample releaseScale = Sample(1.f);
  /// The gate this pair's voices are playing, when nothing is plugged into Gate. Held here rather
  /// than built per block: `process` allocates nothing.
  std::array<Sample, kMaxBlockSize> noteGate{};
  /// The age of the note each of this pair's two voices was last seen playing, so a note that STOLE a
  /// voice still reads as a new note. Nothing else can tell: a stolen voice is held before and after.
  uint64_t lastAge[2] = {0, 0};

  Pair() {
    envelope.plug(&delay, vital::Envelope::kDelay);
    envelope.plug(&attack, vital::Envelope::kAttack);
    envelope.plug(&attackPower, vital::Envelope::kAttackPower);
    envelope.plug(&hold, vital::Envelope::kHold);
    envelope.plug(&decay, vital::Envelope::kDecay);
    envelope.plug(&decayPower, vital::Envelope::kDecayPower);
    envelope.plug(&sustain, vital::Envelope::kSustain);
    envelope.plug(&release, vital::Envelope::kRelease);
    envelope.plug(&releasePower, vital::Envelope::kReleasePower);
    envelope.plug(&trigger, vital::Envelope::kTrigger);
    delay.buffer[0] = Sample(0.f);
    hold.buffer[0] = Sample(0.f);
  }
};

class EnvAdsr final : public Module {
public:
  void prepare(const PrepareInfo& info) override {
    pairs_.clear();
    for (uint32_t p = 0; p < (info.voiceCount + 1) / 2; ++p) {
      pairs_.push_back(std::make_unique<Pair>());
      pairs_.back()->envelope.setSampleRate(static_cast<int>(info.sampleRate));
    }
    activeVoice_.store(-1, std::memory_order_relaxed);
    liveStage_.store(static_cast<float>(vital::kInvalid), std::memory_order_relaxed);
    livePosition_.store(0.f, std::memory_order_relaxed);
    liveValue_.store(0.f, std::memory_order_relaxed);
  }

  /// A voice pair that was dead and is live again. The vendored envelope has no state to clear -- it
  /// ran its release out to zero before the voice was freed, and a trigger sets its stage and position
  /// anyway -- but the gate level and the Relative latches are ours and must not carry over.
  void reset(uint32_t voicePair) override {
    if (voicePair >= pairs_.size()) return;
    Pair& p = *pairs_[voicePair];
    p.envelope.hardReset();
    p.lastGate = Sample(0.f);
    p.lastValue = Sample(0.f);
    p.attackScale = Sample(1.f);
    p.releaseScale = Sample(1.f);
    p.lastAge[0] = p.lastAge[1] = 0;
  }

  void process(ProcessContext& c) override {
    if (c.voice >= pairs_.size()) return;   // a pair the module was never prepared for
    Pair& p = *pairs_[c.voice];
    const uint32_t n = c.numFrames;
    if (n == 0) return;

    const Sample* signalIn = c.in(kSignalIn).readOr();
    const Sample* gate = c.in(kGateIn).empty() ? gateFromNotes(c, p) : c.in(kGateIn).data;
    // Stepped and unmodulatable, so it is one value for the whole block: branch on it once.
    const int model = static_cast<int>(lanes::lane(c.param(kModel).at(0), 0) + 0.5f);

    // 1. The gate, as triggers. The vendored framework carries one per lane per block, which is what
    //    `deriveTriggers` produces from the edges; the envelope reads only these, never the buffer.
    vendor::deriveTriggers(gate, n, p.lastGate, p.trigger);

    // 2. The knobs. The vendored envelope reads its times once per block -- `delta_attack` and its
    //    kin are computed from `input(kAttack)->at(0)` -- so a control-rate output is exactly what it
    //    consumes, and a per-sample copy would be thrown away.
    const Sample attack = vital::utils::max(c.param(kAttack).at(0), Sample(0.f));
    const Sample decay = vital::utils::max(c.param(kDecay).at(0), Sample(0.f));
    const Sample release = vital::utils::max(c.param(kRelease).at(0), Sample(0.f));
    const Sample sustain = vital::utils::clamp(c.param(kSustain).at(0) * (1.f / 100.f), 0.f, 1.f);

    // 3. Relative: each knob is the time to cross the WHOLE range, so a stage that has less ground to
    //    cover takes proportionally less time. Latched per lane when the stage begins, from the level
    //    the envelope ended the last block at -- within one block of the sample where the vendored
    //    processor latches its own `start_value_`, which is the approximation ADR 0008 records.
    if (model == kRelative) latchRelative(p);
    const Sample attackTime = model == kRelative ? attack * p.attackScale : attack;
    const Sample decayTime = model == kRelative ? decay * (Sample(1.f) - sustain) : decay;
    const Sample releaseTime = model == kRelative ? release * p.releaseScale : release;

    p.attack.buffer[0] = attackTime;
    p.decay.buffer[0] = decayTime;
    p.release.buffer[0] = releaseTime;
    p.sustain.buffer[0] = sustain;
    p.attackPower.buffer[0] = Sample(attackPowerOf(model));
    p.decayPower.buffer[0] = Sample(decayPowerOf(model));
    p.releasePower.buffer[0] = Sample(releasePowerOf(model));

    // 4. Run the vendored envelope.
    p.envelope.process(static_cast<int>(n));
    const Sample* env = p.envelope.output(vital::Envelope::kValue)->buffer;
    const Sample phase = p.envelope.output(vital::Envelope::kPhase)->buffer[0];
    p.lastValue = env[n - 1];

    // 5. The outputs. Signal Out is the amplifier: linear, except in Analog, where the gain is the
    //    square of the envelope -- the same curve `amp.vca`'s Exponential uses, which tracks how
    //    loudness is heard and is what "non-linear VCA" means on the switch.
    if (Sample* out = c.out(kSignalOut).data) {
      if (model == kAnalog)
        for (uint32_t i = 0; i < n; ++i) out[i] = signalIn[i] * env[i] * env[i];
      else
        for (uint32_t i = 0; i < n; ++i) out[i] = signalIn[i] * env[i];
    }
    if (Sample* out = c.out(kEnvOut).data)
      for (uint32_t i = 0; i < n; ++i) out[i] = env[i];
    if (Sample* out = c.out(kBiasOut).data)
      for (uint32_t i = 0; i < n; ++i) out[i] = env[i] - sustain;

    // 6. Voice lifetime: while the envelope has not finished, the voice it belongs to is still going.
    //    The claim is the envelope's own stage rather than a guess from its level (ADR 0002).
    if (c.activity != nullptr && lanes::lane(c.param(kLifetime).at(0), 0) > 0.5f) {
      for (uint32_t lane = 0; lane < 4; lane += 2) {
        const float a = lanes::lane(phase, lane), b = lanes::lane(phase, lane + 1);
        if (going(a) || going(b)) c.activity->hold(2 * c.voice + lane / 2);
      }
    }

    // 7. What the picture's playhead follows: the voice that most recently took a note, so the face
    //    shows the newest one rather than an arbitrary lane. Relaxed stores read by the message
    //    thread in `preview`, the same way the scheduler leaves live param values on an instance.
    publishPlayhead(c, p, phase);
  }

  /**
   * The envelope's picture, for the `adsr` block on its face: the shape the knobs describe, plus
   * where the sounding voice has got to. Message thread.
   */
  bool preview(const ParamValues& values, float* out, uint32_t count) override {
    auto read = [&values](const char* id, float fallback) {
      const auto it = values.find(id);
      return it == values.end() ? fallback : it->second;
    };
    Shape s;
    s.attack = std::max(0.f, read("attack", 0.f));
    s.decay = std::max(0.f, read("decay", 0.f));
    s.release = std::max(0.f, read("release", 0.f));
    s.sustain = std::clamp(read("sustain", 100.f) / 100.f, 0.f, 1.f);
    s.model = static_cast<int>(std::lround(read("model", 0.f)));
    s.stage = liveStage_.load(std::memory_order_relaxed);
    s.position = livePosition_.load(std::memory_order_relaxed);
    s.value = liveValue_.load(std::memory_order_relaxed);
    drawPicture(s, out, count);
    return true;
  }

private:
  /**
   * The gate a voice's own note makes, for an envelope with nothing plugged into Gate.
   *
   * The pool has already been marked for this block (the entry's `allocate` runs before the passes),
   * so this is high exactly while a voice is holding a note. Block-accurate rather than
   * sample-accurate: the pool records the state, not the frame the note landed on, so an edge can be
   * up to one block early. A cable from the converter's own Gate output is exact, which is why the
   * port is still there and why the doc says so.
   *
   * Outside an instrument there is no pool and no note, so an unconnected gate reads as held: the
   * envelope opens and stays open, which is what makes a global one usable as a plain shaper.
   */
  static const Sample* gateFromNotes(const ProcessContext& c, Pair& p) {
    float lane[4];
    float first[4];   // frame 0, which differs only where a note has to retrigger
    for (uint32_t v = 0; v < 2; ++v) {
      const uint32_t voice = 2 * c.voice + v;
      const bool held = c.activity == nullptr || c.activity->state(voice) == VoiceState::Held;
      // A note that stole a live voice leaves it held before and after, so the level alone says
      // nothing happened. The pool numbers every note on, so a changed age is a new note: drop the
      // gate for one frame and the envelope retriggers, which is the dip `note.toPoly` puts on its
      // own Gate output for the same reason.
      const uint64_t age = c.activity == nullptr ? 0 : c.activity->age(voice);
      const bool fresh = held && age != p.lastAge[v];
      p.lastAge[v] = age;
      lane[2 * v] = lane[2 * v + 1] = held ? 1.f : 0.f;
      first[2 * v] = first[2 * v + 1] = fresh ? 0.f : lane[2 * v];
    }
    const Sample value(lane[0], lane[1], lane[2], lane[3]);
    // A one-frame block is a sample-rate feedback cluster; there is no room for a dip and no room for
    // the note either, so it simply starts a frame later than it would.
    p.noteGate[0] = c.numFrames > 1 ? Sample(first[0], first[1], first[2], first[3]) : value;
    for (uint32_t i = 1; i < c.numFrames; ++i) p.noteGate[i] = value;
    return p.noteGate.data();
  }

  static bool going(float stage) {
    return stage >= static_cast<float>(vital::kVoiceIdle) && stage < static_cast<float>(vital::kVoiceKill);
  }

  /// Relative's latches: a lane starting its attack has `1 - value` left to climb, one starting its
  /// release has `value` left to fall. Zero distance means an instant stage, which is the point.
  static void latchRelative(Pair& p) {
    const vital::poly_mask triggered = p.trigger.trigger_mask;
    const vital::poly_mask on = triggered & vital::poly_float::equal(p.trigger.trigger_value,
                                                                    static_cast<float>(vital::kVoiceOn));
    const vital::poly_mask off = triggered & vital::poly_float::equal(p.trigger.trigger_value,
                                                                     static_cast<float>(vital::kVoiceOff));
    const Sample level = vital::utils::clamp(p.lastValue, 0.f, 1.f);
    p.attackScale = vital::utils::maskLoad(p.attackScale, Sample(1.f) - level, on);
    p.releaseScale = vital::utils::maskLoad(p.releaseScale, level, off);
  }

  void publishPlayhead(const ProcessContext& c, const Pair& p, Sample phase) {
    // A rising edge anywhere in this pair takes the picture over.
    const vital::poly_mask on = p.trigger.trigger_mask &
                                vital::poly_float::equal(p.trigger.trigger_value,
                                                         static_cast<float>(vital::kVoiceOn));
    for (uint32_t lane = 0; lane < 4; lane += 2)
      if (on[static_cast<int>(lane)] || on[static_cast<int>(lane + 1)])
        activeVoice_.store(static_cast<int>(2 * c.voice + lane / 2), std::memory_order_relaxed);

    const int active = activeVoice_.load(std::memory_order_relaxed);
    if (active < 0 || static_cast<uint32_t>(active) / 2 != c.voice) return;
    const uint32_t lane = 2 * (static_cast<uint32_t>(active) % 2);
    const float stagePlusPosition = lanes::lane(phase, lane);
    const float stage = std::floor(stagePlusPosition);
    liveStage_.store(stage, std::memory_order_relaxed);
    livePosition_.store(stagePlusPosition - stage, std::memory_order_relaxed);
    liveValue_.store(lanes::lane(p.lastValue, lane), std::memory_order_relaxed);
  }

  std::vector<std::unique_ptr<Pair>> pairs_;
  /// Which voice the picture follows, or -1 before the first note. Audio thread writes, message
  /// thread reads; relaxed throughout, because a picture one frame stale is a picture.
  std::atomic<int> activeVoice_{-1};
  std::atomic<float> liveStage_{static_cast<float>(vital::kInvalid)};
  std::atomic<float> livePosition_{0.f};
  std::atomic<float> liveValue_{0.f};
};

}  // namespace

// Explicit `extern` (see AudioOut.cpp): a namespace-scope `const` is internal linkage by default.
extern const ModuleDescriptor kEnvAdsr{kModuleAbiVersion, "env.adsr", "ADSR", "Modulation",
  "A gated four-stage envelope. A high gate starts the attack, which rises to full scale and decays to "
  "the sustain level; a low gate starts the release. Signal In comes back out of Signal Out with the "
  "envelope applied, so a note needs no separate amplifier, and Envelope Out drives anything else. "
  "Bias Out is the envelope less its sustain, so it rests at zero while a note is held. Model chooses "
  "the curves and the timing.",
  kIn, countOf(kIn), kOut, countOf(kOut), kParams, countOf(kParams), kModulePreviewsEnvelope, 0,
  [] () -> Module* { return new EnvAdsr(); }, kFace, countOf(kFace)};

}  // namespace pg::modules

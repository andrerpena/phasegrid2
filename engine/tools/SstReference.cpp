/**
 * Runs an sst effect OUTSIDE the engine, over a WAV, so its output can be compared with what
 * `fx.*` produces inside it.
 *
 *   build/engine/pg-sst-ref --list
 *   build/engine/pg-sst-ref reverb2 dry.wav ref.wav mix=0.5 decay_time=3
 *
 * This exists to answer one question quickly and without argument: **is the adapter wrong, or is
 * this what the effect does?** Render the same dry signal through the engine and through this, and
 * compare with `npm run audio:measure`. When they match, `engine/src/sst` is faithful and the
 * problem is the parameters or the patch; when they differ, it is ours.
 *
 * It is worth having because that question came up for real. `fx.reverb` sounded thin and
 * indistinct, and the first instinct was to suspect the block adaptation or the lane conversion. The
 * two renders matched to three decimal places, which ruled the adapter out in one step and left the
 * actual cause -- the effect's shipped defaults, LF Damping in particular -- in plain sight
 * (docs/adrs/0010).
 *
 * Values are given in the effect's OWN units, not the display units the descriptor publishes, since
 * the point is to bypass everything phasegrid does to them.
 */
#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <functional>
#include <map>
#include <memory>
#include <string>
#include <vector>

#include "sst/Config.hpp"
#include "sst/effects/Bonsai.h"
#include "sst/effects/Delay.h"
#include "sst/effects/Flanger.h"
#include "sst/effects/FloatyDelay.h"
#include "sst/effects/Phaser.h"
#include "sst/effects/Reverb1.h"
#include "sst/effects/Reverb2.h"
#include "sst/effects/RotarySpeaker.h"

namespace {

using namespace pg::sstfx;

struct Runner {
  virtual ~Runner() = default;
  virtual int numParams() const = 0;
  virtual std::string nameAt(int i) const = 0;
  virtual float defaultAt(int i) const = 0;
  virtual void set(int i, float v) = 0;
  virtual void initialize() = 0;
  virtual void processBlock(float* l, float* r) = 0;
  virtual void setSampleRate(double sr) = 0;
};

template <class Fx>
struct Concrete final : Runner {
  Global g;
  EffectState st;
  Values vals;
  Fx fx;
  Concrete() : fx(&g, &st, &vals) {}
  int numParams() const override { return static_cast<int>(Fx::numParams); }
  std::string nameAt(int i) const override { return fx.paramAt(i).name; }
  float defaultAt(int i) const override { return fx.paramAt(i).defaultVal; }
  void set(int i, float v) override { vals.v[i] = v; }
  void initialize() override { fx.initialize(); }
  void processBlock(float* l, float* r) override { fx.processBlock(l, r); }
  void setSampleRate(double sr) override {
    g.samplerate = sr;
    g.dsamplerate_inv = 1.0 / sr;
    fx.onSampleRateChanged();
  }
};

const std::map<std::string, std::function<Runner*()>>& effects() {
  static const std::map<std::string, std::function<Runner*()>> all = {
    {"reverb2", [] { return new Concrete<sst::effects::reverb2::Reverb2<Config>>(); }},
    {"reverb1", [] { return new Concrete<sst::effects::reverb1::Reverb1<Config>>(); }},
    {"delay", [] { return new Concrete<sst::effects::delay::Delay<Config>>(); }},
    {"floatydelay", [] { return new Concrete<sst::effects::floatydelay::FloatyDelay<Config>>(); }},
    {"flanger", [] { return new Concrete<sst::effects::flanger::Flanger<Config>>(); }},
    {"phaser", [] { return new Concrete<sst::effects::phaser::Phaser<Config>>(); }},
    {"bonsai", [] { return new Concrete<sst::effects::bonsai::Bonsai<Config>>(); }},
    {"rotaryspeaker", [] { return new Concrete<sst::effects::rotaryspeaker::RotarySpeaker<Config>>(); }},
  };
  return all;
}

/// The same id the descriptor generator makes: lowercase, runs of punctuation to one underscore.
std::string slug(const std::string& text) {
  std::string out;
  bool pending = false;
  for (const char c : text) {
    if (std::isalnum(static_cast<unsigned char>(c))) {
      if (pending && !out.empty()) out.push_back('_');
      pending = false;
      out.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
    } else {
      pending = true;
    }
  }
  return out;
}

std::vector<float> readWav(const char* path, int& channels, int& rate) {
  FILE* f = std::fopen(path, "rb");
  if (f == nullptr) {
    std::fprintf(stderr, "cannot open %s\n", path);
    std::exit(2);
  }
  std::fseek(f, 0, SEEK_END);
  const long size = std::ftell(f);
  std::fseek(f, 0, SEEK_SET);
  std::vector<unsigned char> bytes(static_cast<size_t>(size));
  if (std::fread(bytes.data(), 1, bytes.size(), f) != bytes.size()) { /* short read is caught below */ }
  std::fclose(f);

  std::vector<float> out;
  channels = 2;
  rate = 48000;
  size_t i = 12;
  while (i + 8 <= bytes.size()) {
    char id[5] = {};
    std::memcpy(id, &bytes[i], 4);
    uint32_t chunk = 0;
    std::memcpy(&chunk, &bytes[i + 4], 4);
    if (std::strcmp(id, "fmt ") == 0) {
      uint16_t ch = 2;
      std::memcpy(&ch, &bytes[i + 10], 2);
      channels = ch;
      std::memcpy(&rate, &bytes[i + 12], 4);
    }
    if (std::strcmp(id, "data") == 0) {
      out.resize(chunk / sizeof(float));
      std::memcpy(out.data(), &bytes[i + 8], chunk);
      break;
    }
    i += 8 + chunk + (chunk & 1);
  }
  if (out.empty()) {
    std::fprintf(stderr, "%s has no 32-bit float data chunk (the engine's --render writes one)\n", path);
    std::exit(2);
  }
  return out;
}

void writeWav(const char* path, const std::vector<float>& interleaved, int rate) {
  FILE* f = std::fopen(path, "wb");
  const uint32_t dataBytes = static_cast<uint32_t>(interleaved.size() * sizeof(float));
  const uint32_t riff = 36 + dataBytes;
  const uint32_t fmtSize = 16;
  const uint16_t tag = 3, channels = 2, bits = 32, align = 8;
  const uint32_t byteRate = static_cast<uint32_t>(rate) * align;
  std::fwrite("RIFF", 1, 4, f);
  std::fwrite(&riff, 4, 1, f);
  std::fwrite("WAVE", 1, 4, f);
  std::fwrite("fmt ", 1, 4, f);
  std::fwrite(&fmtSize, 4, 1, f);
  std::fwrite(&tag, 2, 1, f);
  std::fwrite(&channels, 2, 1, f);
  std::fwrite(&rate, 4, 1, f);
  std::fwrite(&byteRate, 4, 1, f);
  std::fwrite(&align, 2, 1, f);
  std::fwrite(&bits, 2, 1, f);
  std::fwrite("data", 1, 4, f);
  std::fwrite(&dataBytes, 4, 1, f);
  std::fwrite(interleaved.data(), 1, dataBytes, f);
  std::fclose(f);
}

}  // namespace

int main(int argc, char** argv) {
  if (argc >= 2 && std::string(argv[1]) == "--list") {
    for (const auto& [name, make] : effects()) {
      const std::unique_ptr<Runner> r(make());
      std::printf("%-16s", name.c_str());
      for (int i = 0; i < r->numParams(); ++i)
        std::printf(" %s=%g", slug(r->nameAt(i)).c_str(), r->defaultAt(i));
      std::printf("\n");
    }
    return 0;
  }
  if (argc < 4) {
    std::fprintf(stderr,
                 "usage: pg-sst-ref <effect> <in.wav> <out.wav> [param=nativeValue ...]\n"
                 "       pg-sst-ref --list\n"
                 "Values are the EFFECT's own, not the display units the descriptor publishes.\n");
    return 2;
  }

  const auto it = effects().find(argv[1]);
  if (it == effects().end()) {
    std::fprintf(stderr, "no effect %s; --list shows what there is\n", argv[1]);
    return 2;
  }
  const std::unique_ptr<Runner> fx(it->second());

  int channels = 2, rate = 48000;
  const std::vector<float> in = readWav(argv[2], channels, rate);
  fx->setSampleRate(rate);
  for (int i = 0; i < fx->numParams(); ++i) fx->set(i, fx->defaultAt(i));

  for (int a = 4; a < argc; ++a) {
    const std::string arg = argv[a];
    const size_t eq = arg.find('=');
    if (eq == std::string::npos) {
      std::fprintf(stderr, "expected param=value, got %s\n", argv[a]);
      return 2;
    }
    const std::string key = arg.substr(0, eq);
    const float value = std::strtof(arg.c_str() + eq + 1, nullptr);
    bool found = false;
    for (int i = 0; i < fx->numParams(); ++i) {
      if (slug(fx->nameAt(i)) == key) {
        fx->set(i, value);
        std::printf("set %s[%d] = %g\n", key.c_str(), i, value);
        found = true;
      }
    }
    if (!found) {
      std::fprintf(stderr, "no param %s on %s; --list shows what there is\n", key.c_str(), argv[1]);
      return 2;
    }
  }
  fx->initialize();

  const size_t frames = in.size() / static_cast<size_t>(channels);
  std::vector<float> out(frames * 2, 0.f);
  alignas(16) float left[kSstBlock], right[kSstBlock];
  for (size_t base = 0; base + kSstBlock <= frames; base += kSstBlock) {
    for (uint32_t i = 0; i < kSstBlock; ++i) {
      const size_t f = base + i;
      left[i] = in[f * static_cast<size_t>(channels)];
      right[i] = channels > 1 ? in[f * static_cast<size_t>(channels) + 1] : left[i];
    }
    fx->processBlock(left, right);
    for (uint32_t i = 0; i < kSstBlock; ++i) {
      out[(base + i) * 2] = left[i];
      out[(base + i) * 2 + 1] = right[i];
    }
  }
  writeWav(argv[3], out, rate);

  double sum = 0;
  for (const float v : out) sum += static_cast<double>(v) * v;
  std::printf("wrote %s  %zu frames  rms %.5f\n", argv[3], frames, std::sqrt(sum / out.size()));
  return 0;
}

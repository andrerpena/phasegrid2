#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>
#include "modules/builtin.hpp"
#include "render/OfflineRenderer.hpp"
#include "util/GraphFixture.hpp"
#include "util/RtGuard.hpp"
#include "vital/SampleBank.hpp"

namespace {

/// Writes `frames` frames of DC at `left`/`right` and hands back the path. DC on purpose: the band-limited
/// pyramid the loader builds resamples and pads the content, so only a constant survives every band with a
/// value a test can assert on exactly, whatever offset the vendored buffers put it at.
std::string writeDcWav(const std::string& name, uint32_t frames, uint32_t channels, float left, float right) {
  const std::string path = (std::filesystem::temp_directory_path() / name).string();
  std::vector<float> data(static_cast<size_t>(frames) * channels);
  for (uint32_t i = 0; i < frames; ++i) {
    data[static_cast<size_t>(i) * channels] = left;
    if (channels == 2) data[static_cast<size_t>(i) * channels + 1] = right;
  }
  std::string error;
  REQUIRE(pg::writeWav(path, data, channels, 48000.0, error));
  return path;
}

/// Reads one interior sample of a loaded sample's original-rate band. Interior on purpose: the vendored
/// pyramid pads every band with four zero samples at each end, so the edges are not the content.
struct Reader {
  vital::Sample& sample;
  explicit Reader(vital::Sample& s) : sample(s) { s.markUsed(); }
  ~Reader() { sample.markUnused(); }
  Reader(const Reader&) = delete;
  Reader& operator=(const Reader&) = delete;
  float left(int frame) const { return sample.getActiveLeftBuffer(1)[frame + vital::Sample::kBufferSamples]; }
  float right(int frame) const { return sample.getActiveRightBuffer(1)[frame + vital::Sample::kBufferSamples]; }
};

}  // namespace

TEST_CASE("the sample bank decodes a stereo WAV into a vendored sample", "[sampler]") {
  const std::string path = writeDcWav("pg_stereo.wav", 4800, 2, 0.5f, -0.25f);
  vital::Sample sample;
  REQUIRE(pg::vendor::SampleBank::loadWav(path, sample));
  REQUIRE(sample.originalLength() == 4800);
  REQUIRE(sample.sampleRate() == 48000);

  // The channels must land in their own buffers: a loader that interleaved them, or that copied left into
  // both, would read 0.5 on the right too.
  const Reader reader(sample);
  REQUIRE(reader.left(100) == Catch::Approx(0.5f).margin(1e-4f));
  REQUIRE(reader.right(100) == Catch::Approx(-0.25f).margin(1e-4f));
  REQUIRE(reader.left(4000) == Catch::Approx(0.5f).margin(1e-4f));
}

TEST_CASE("the sample bank decodes a mono WAV and mirrors it to both sides", "[sampler]") {
  const std::string path = writeDcWav("pg_mono.wav", 2400, 1, 0.75f, 0.f);
  vital::Sample sample;
  REQUIRE(pg::vendor::SampleBank::loadWav(path, sample));
  REQUIRE(sample.originalLength() == 2400);
  const Reader reader(sample);
  REQUIRE(reader.left(100) == Catch::Approx(0.75f).margin(1e-4f));
  REQUIRE(reader.right(100) == Catch::Approx(0.75f).margin(1e-4f));   // mono reads the left buffer
}

TEST_CASE("the sample bank reports what it could not read", "[sampler]") {
  vital::Sample sample;
  const pg::Result missing = pg::vendor::SampleBank::loadWav("/nonexistent/pg_missing.wav", sample);
  REQUIRE_FALSE(missing);
  REQUIRE(missing.code == "E_IO");

  const std::string junk = (std::filesystem::temp_directory_path() / "pg_junk.wav").string();
  { std::ofstream out(junk); out << "not audio at all"; }
  const pg::Result bad = pg::vendor::SampleBank::loadWav(junk, sample);
  REQUIRE_FALSE(bad);
  REQUIRE(bad.code == "E_IO");

  // A failed load leaves the sample as it was, so a bad path cannot silence a running player.
  REQUIRE(sample.originalLength() > 0);
}

TEST_CASE("sampler.player descriptor is generated from the vendored parameter table", "[sampler]") {
  pg::Registry reg;
  pg::registerBuiltinModules(reg);
  const pg::RegisteredModule* s = reg.find("sampler.player");
  REQUIRE(s != nullptr);
  REQUIRE(s->findInput("gate") == 0);
  REQUIRE(s->findInput("pitch") == 1);
  REQUIRE(s->findInput("count") == 2);
  REQUIRE(s->findOutput("out") == 0);
  REQUIRE(s->findOutput("raw") == 1);

  for (const char* id : {"bounce", "keytrack", "level", "loop", "pan", "random_phase", "transpose",
                         "transpose_quantize", "tune"})
    REQUIRE(s->findParam(id) >= 0);
  REQUIRE(s->desc->numParams == 9);        // the vendored `sample_on` switch is hidden; a grid module is always on
  REQUIRE(s->findParam("on") == -1);

  // Level, pan and tune have poly modulation destinations behind them, so they get implicit ports.
  for (const char* id : {"level", "pan", "tune"}) {
    const int32_t p = s->findParam(id);
    REQUIRE((s->desc->params[p].flags & pg::kParamModulatable) != 0);
    REQUIRE(s->findInput(std::string("param:") + id) >= 0);
  }
  // Transpose is stepped in the vendored table, so it is a plain integer with no continuous port.
  const int32_t transpose = s->findParam("transpose");
  REQUIRE((s->desc->params[transpose].flags & pg::kParamInteger) != 0);
  REQUIRE(s->desc->params[transpose].min == Catch::Approx(-48.f));
  REQUIRE(s->desc->params[transpose].max == Catch::Approx(48.f));
  REQUIRE(s->desc->params[transpose].enumCount == 0);   // 97 steps, no name table behind them

  // The switches do have a name table, and it is exactly as long as their range.
  const int32_t loop = s->findParam("loop");
  REQUIRE((s->desc->params[loop].flags & pg::kParamEnum) != 0);
  REQUIRE(s->desc->params[loop].enumCount == 2);

  for (uint32_t i = 0; i < s->desc->numParams; ++i)
    REQUIRE(std::string(s->desc->params[i].id).find("sample_") == std::string::npos);
}

TEST_CASE("sampler.player plays on a gate and follows its level knob", "[sampler]") {
  // The gain the module applied between its two outputs, measured on one instance so the content (a
  // different random noise per instance) cancels out. The vendored control is smoothed at 5 Hz, so the run
  // is long enough for it to have settled before the block that gets measured.
  auto gainAtLevel = [](float level) {
    pg::test::GraphFixture f;
    pg::registerBuiltinModules(f.reg);
    f.node("g", "test.const", {{"value", 1.f}});
    f.node("smp", "sampler.player", {{"level", level}, {"loop", 1.f}});
    f.edge("e", "g.out", "smp.gate");
    auto p = f.compile();
    for (int b = 0; b < 400; ++b) f.run(*p, 64);
    float levelled = 0.f, raw = 0.f;
    for (uint32_t i = 0; i < 64; ++i) {
      levelled += std::fabs(f.out(*p, "smp", "out", i));
      raw += std::fabs(f.out(*p, "smp", "raw", i));
    }
    REQUIRE(raw > 0.f);   // the sample the vendored player is born with really plays
    return levelled / raw;
  };
  // Level is squared inside the vendored source, so halving the knob quarters the gain. A knob that never
  // reached the module would leave both instances at the same default and the ratio at 1.
  REQUIRE(gainAtLevel(0.5f) / gainAtLevel(1.f) == Catch::Approx(0.25f).epsilon(0.02));
}

TEST_CASE("sampler.player steady state is allocation free", "[sampler][rt]") {
  pg::test::GraphFixture f;
  pg::registerBuiltinModules(f.reg);
  f.node("g", "test.const", {{"value", 1.f}});
  f.node("smp", "sampler.player", {{"loop", 1.f}});
  f.edge("e", "g.out", "smp.gate");
  auto p = f.compile();
  f.run(*p, 64);
  float energy = 0.f;
  for (uint32_t i = 0; i < 64; ++i) energy += std::fabs(f.out(*p, "smp", "out", i));
  REQUIRE(energy > 0.f);   // producing output, so the check below is not measuring a dead graph
  pg::test::resetRtViolations();
  { pg::test::RtScope scope; for (int b = 0; b < 100; ++b) f.run(*p, 64); }
  REQUIRE(pg::test::rtViolations() == 0);
}

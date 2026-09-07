#include <catch2/catch_approx.hpp>
#include <catch2/catch_test_macros.hpp>
#include "core/Descriptor.hpp"
#include "core/Param.hpp"
#include "core/Signal.hpp"

static pg::ParamDesc lin{"g", "Gain", 0.f, 2.f, 1.f, pg::ParamUnit::Ratio, pg::ParamCurve::Linear, pg::kParamModulatable, nullptr, 0, "slider", nullptr, nullptr};
static pg::ParamDesc logp{"c", "Cutoff", 20.f, 20000.f, 1000.f, pg::ParamUnit::Hz, pg::ParamCurve::Log, pg::kParamModulatable, nullptr, 0, "slider", nullptr, nullptr};
static const char* kModes[] = {"LP", "HP", "BP"};
static pg::ParamDesc en{"m", "Mode", 0.f, 2.f, 0.f, pg::ParamUnit::None, pg::ParamCurve::Linear, pg::kParamEnum | pg::kParamInteger | pg::kParamNoSmooth, kModes, 3, "select", nullptr, nullptr};

TEST_CASE("param curves round-trip and clamp", "[param]") {
  REQUIRE(pg::paramDenormalize(lin, 0.5f) == Catch::Approx(1.f));
  REQUIRE(pg::paramNormalize(lin, 2.f) == Catch::Approx(1.f));
  REQUIRE(pg::paramNormalize(lin, 5.f) == Catch::Approx(1.f));
  REQUIRE(pg::paramDenormalize(logp, 0.f) == Catch::Approx(20.f));
  REQUIRE(pg::paramDenormalize(logp, 1.f) == Catch::Approx(20000.f));
  REQUIRE(pg::paramNormalize(logp, pg::paramDenormalize(logp, 0.3f)) == Catch::Approx(0.3f).epsilon(1e-4));
  REQUIRE(pg::paramDenormalize(en, 0.74f) == Catch::Approx(1.f));
  REQUIRE(pg::paramDenormalize(en, 0.76f) == Catch::Approx(2.f));
}

TEST_CASE("lane-wise denormalize matches scalar per lane and clamps", "[param]") {
  const pg::Sample norm(0.25f, 0.5f, 1.5f, -1.f);
  const pg::Sample v = pg::paramDenormalize(lin, norm);
  REQUIRE(pg::lanes::lane(v, 0) == Catch::Approx(0.5f));
  REQUIRE(pg::lanes::lane(v, 1) == Catch::Approx(1.f));
  REQUIRE(pg::lanes::lane(v, 2) == Catch::Approx(2.f));   // clamped
  REQUIRE(pg::lanes::lane(v, 3) == Catch::Approx(0.f));   // clamped
  const pg::Sample lv = pg::paramDenormalize(logp, pg::Sample(0.3f));
  REQUIRE(pg::lanes::lane(lv, 0) == Catch::Approx(pg::paramDenormalize(logp, 0.3f)).epsilon(1e-3));
  const pg::Sample ev = pg::paramDenormalize(en, pg::Sample(0.74f, 0.76f, 0.f, 1.f));
  REQUIRE(pg::lanes::lane(ev, 0) == 1.f);
  REQUIRE(pg::lanes::lane(ev, 1) == 2.f);
}

TEST_CASE("smoother ramps toward target and reports movement", "[param]") {
  pg::OnePoleSmoother s;
  s.prepare(48000.0, 5.f);
  s.snap(0.f);
  REQUIRE_FALSE(s.isMoving());
  s.setTarget(1.f);
  REQUIRE(s.isMoving());
  float last = 0.f;
  for (int i = 0; i < 48000; ++i) { const float v = s.next(); REQUIRE(v >= last); last = v; }
  REQUIRE(last == Catch::Approx(1.f).margin(1e-5));
  REQUIRE_FALSE(s.isMoving());
}

TEST_CASE("ParamState produces constants when idle and ramps when moving; ParamView reads all three forms", "[param]") {
  pg::ParamState p;
  p.prepare(&lin, 48000.0, 0.5f);
  p.fillRamp(64);
  REQUIRE(p.rampIsConstant);
  REQUIRE(p.constValue == Catch::Approx(1.f));
  pg::ParamView constant{nullptr, nullptr, p.constValue};
  REQUIRE(pg::lanes::lane(constant.at(10), 2) == Catch::Approx(1.f));
  p.setTargetNorm(1.f);
  p.fillRamp(64);
  REQUIRE_FALSE(p.rampIsConstant);
  REQUIRE(p.rampValue[63] > p.rampValue[0]);
  pg::ParamView ramp{nullptr, p.rampValue.data(), 0.f};
  REQUIRE(pg::lanes::lane(ramp.at(63), 3) == Catch::Approx(p.rampValue[63]));
  pg::Sample poly[2] = {pg::Sample(1.f, 2.f, 3.f, 4.f), pg::Sample(5.f)};
  pg::ParamView modulated{poly, nullptr, 0.f};
  REQUIRE(pg::lanes::lane(modulated.at(0), 1) == 2.f);
  REQUIRE(pg::lanes::lane(modulated.at(1), 3) == 5.f);
  pg::ParamState e;
  e.prepare(&en, 48000.0, 0.f);
  e.setTargetNorm(1.f);
  e.fillRamp(64);
  REQUIRE(e.rampIsConstant);
  REQUIRE(e.constValue == Catch::Approx(2.f));
}

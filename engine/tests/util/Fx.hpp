#pragma once
#include <catch2/catch_test_macros.hpp>
#include <cmath>
#include <map>
#include <memory>
#include <string>
#include "modules/builtin.hpp"
#include "util/GraphFixture.hpp"

namespace pg::test {

/// A source into one effect. The source is either a gated oscillator (`sine`) or a DC level (`level`);
/// both are steady, which matters because every one of these effects ramps its wet/dry mix and its filter
/// coefficients across the first block it sees. An impulse fired into block 0 is swallowed by that ramp.
struct Fx {
  pg::test::GraphFixture f;
  std::unique_ptr<pg::Program> program;

  /// `table` picks the wavetable the `sine` source plays (1 is a sine, 6 a sawtooth) and `transpose`
  /// shifts it in semitones. Both are for measuring a stereo effect across the spectrum rather than
  /// at one frequency: a single tone lands on a peak of one channel's comb structure and in a notch
  /// of the other's, and says nothing about whether the two sides are balanced.
  Fx(const char* id, std::map<std::string, float> params, bool sine, float level = 1.f,
     float table = 1.f, float transpose = 0.f) {
    pg::registerBuiltinModules(f.reg);
    f.node("dc", "test.const", {{"value", level}});
    f.node("silence", "test.const", {{"value", 0.f}});
    if (sine) {
      f.node("gate", "test.const", {{"value", 1.f}});
      f.node("src", "osc.wavetable", {{"table", table}, {"level", 1.f}, {"transpose", transpose}});
      f.edge("g", "gate.out", "src.gate");
    }
    f.node("fx", id, std::move(params));
    f.edge("in", sine ? "src.out" : "dc.out", "fx.in");
    program = f.compile();
  }
  void run(int blocks) { for (int b = 0; b < blocks; ++b) f.run(*program, 64); }
  float at(uint32_t frame, const char* port = "out", uint32_t lane = 0) {
    return f.out(*program, "fx", port, frame, lane);
  }
  double rms(int blocks, const char* node = "fx", const char* port = "out", uint32_t lane = 0) {
    double sum = 0;
    int n = 0;
    for (int b = 0; b < blocks; ++b) {
      f.run(*program, 64);
      for (uint32_t i = 0; i < 64; ++i) {
        const double v = f.out(*program, node, port, i, lane);
        sum += v * v;
        ++n;
      }
    }
    return std::sqrt(sum / n);
  }
  /// Replaces the source with silence, keeping the same effect instance (nothing structural changed).
  void muteInput() {
    REQUIRE(f.model.removeEdge("in"));
    f.edge("in", "silence.out", "fx.in");
    program = f.compile();
  }
};

}  // namespace pg::test

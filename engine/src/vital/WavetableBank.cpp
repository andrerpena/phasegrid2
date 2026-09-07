#include "vital/WavetableBank.hpp"
#include <fstream>
#include "synth_constants.h"
#include "wave_frame.h"
#include "wave_source.h"
#include "wavetable_creator.h"
#include "wavetable_group.h"

namespace pg::vendor {
namespace {

/// One entry per built-in. Index 0 morphs across four shapes; every other index is a single shape held for
/// the whole table, and its `shape` is the wave frame the vendored lookup already provides.
struct Builtin {
  const char* name;
  vital::PredefinedWaveFrames::Shape shape;
};
const Builtin kBuiltins[] = {
  {"Basic Shapes", vital::PredefinedWaveFrames::kSin},   // shape unused; see renderBuiltin
  {"Sine", vital::PredefinedWaveFrames::kSin},
  {"Saturated Sine", vital::PredefinedWaveFrames::kSaturatedSin},
  {"Triangle", vital::PredefinedWaveFrames::kTriangle},
  {"Square", vital::PredefinedWaveFrames::kSquare},
  {"Pulse", vital::PredefinedWaveFrames::kPulse},
  {"Saw", vital::PredefinedWaveFrames::kSaw},
};
/// What "Basic Shapes" sweeps through, evenly spaced over the table's frames.
const vital::PredefinedWaveFrames::Shape kMorph[] = {
  vital::PredefinedWaveFrames::kSin, vital::PredefinedWaveFrames::kTriangle,
  vital::PredefinedWaveFrames::kSquare, vital::PredefinedWaveFrames::kSaw,
};

}  // namespace

uint32_t WavetableBank::numBuiltins() { return static_cast<uint32_t>(std::size(kBuiltins)); }

const char* WavetableBank::builtinName(uint32_t index) {
  return kBuiltins[index < numBuiltins() ? index : 0].name;
}

void WavetableBank::renderBuiltin(uint32_t index, vital::Wavetable& table) {
  const uint32_t i = index < numBuiltins() ? index : 0;
  // A creator drives the render; it owns the group, which owns the source, and all of it dies with this call.
  // Only `table` survives, holding the rendered frames.
  WavetableCreator creator(&table);
  auto* group = new WavetableGroup();
  auto* source = new WaveSource();
  group->addComponent(source);
  creator.addGroup(group);

  if (i == 0) {
    const int last = vital::kNumOscillatorWaveFrames - 1;
    const int steps = static_cast<int>(std::size(kMorph)) - 1;
    for (int k = 0; k <= steps; ++k) {
      source->insertNewKeyframe(k * last / steps);
      source->getWaveFrame(k)->copy(vital::PredefinedWaveFrames::getWaveFrame(kMorph[k]));
    }
  } else {
    source->insertNewKeyframe(0);
    source->getWaveFrame(0)->copy(vital::PredefinedWaveFrames::getWaveFrame(kBuiltins[i].shape));
  }

  creator.setName(kBuiltins[i].name);
  creator.render();
}

Result WavetableBank::loadJson(const nlohmann::json& document, vital::Wavetable& table) {
  if (!WavetableCreator::isValidJson(document)) return Result::fail("E_SCHEMA", "not a wavetable JSON document");
  WavetableCreator creator(&table);
  creator.jsonToState(document);   // renders as its last step
  return {};
}

Result WavetableBank::loadFile(const std::string& path, vital::Wavetable& table) {
  std::ifstream in(path);
  if (!in) return Result::fail("E_IO", "cannot open " + path);
  const nlohmann::json document = nlohmann::json::parse(in, nullptr, false);
  if (document.is_discarded()) return Result::fail("E_SCHEMA", "invalid JSON in " + path);
  return loadJson(document, table);
}

}  // namespace pg::vendor
